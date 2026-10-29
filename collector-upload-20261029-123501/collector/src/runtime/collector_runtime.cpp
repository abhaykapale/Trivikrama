#include "trivikrama/collector/runtime/collector_runtime.hpp"

#include "trivikrama/collector/build_info.hpp"
#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/security/payload_encoding.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <stdexcept>
#include <string>
#include <utility>

namespace trivikrama::collector::runtime {
namespace {

[[nodiscard]] monitoring::HeartbeatPublisherOptions heartbeat_options(
    const config::CollectorConfig& configuration, const std::string& started_at) {
    return monitoring::HeartbeatPublisherOptions{
        configuration.collector.id,
        std::string{BuildInfo::version},
        configuration.collector.configuration_version,
        started_at,
        configuration.output.directory,
        configuration.output.state_directory,
        configuration.output.heartbeat_interval,
        configuration.outbox.maximum_bytes,
        configuration.outbox.maximum_batches,
        configuration.outbox.warning_percent,
        contract::ContractProfile::maximum_encoded_batch_bytes};
}

[[nodiscard]] std::optional<ingress::FileReaderOptions::ResumePosition>
resume_position(const std::optional<durability::CheckpointState>& checkpoint,
                const std::string& source_id) {
    if (!checkpoint.has_value()) {
        return std::nullopt;
    }
    const auto found = checkpoint->sources.find(source_id);
    if (found == checkpoint->sources.end()) {
        return std::nullopt;
    }
    const auto& position = found->second;
    if (!position.contains("file_identity") || !position.contains("end_offset") ||
        !position.at("file_identity").is_string() ||
        !position.at("end_offset").is_number_unsigned()) {
        throw CollectorRuntimeError{"checkpoint contains an invalid file position for " +
                                    source_id};
    }
    return ingress::FileReaderOptions::ResumePosition{
        position.at("file_identity").get<std::string>(),
        position.at("end_offset").get<std::uint64_t>()};
}

} // namespace

CollectorRuntime::CollectorRuntime(const config::CollectorConfig& configuration,
                                   ingress::IUtcClock& clock,
                                   IIdentifierGenerator& identifiers,
                                   monitoring::IResourceProbe& resources)
    : collector_id_{configuration.collector.id}, scheduler_{configuration.scheduler},
      source_settings_{configuration.sources}, clock_{clock}, identifiers_{identifiers},
      resources_{resources},
      signer_{configuration.security.key_id, configuration.security.hmac_secret},
      checkpoints_{configuration.output.checkpoint_file},
      outbox_{durability::OutboxPublisherOptions{
                  configuration.collector.id, configuration.output.outbox_directory,
                  configuration.output.directory, configuration.outbox.maximum_bytes,
                  configuration.outbox.maximum_batches},
              checkpoints_},
      rejected_{configuration.collector.id, configuration.output.rejected_directory,
                checkpoints_},
      queue_{configuration.scheduler.queue_capacity_events,
             configuration.scheduler.queue_capacity_bytes},
      assembler_{configuration.scheduler.batch_size,
                 contract::ContractProfile::maximum_encoded_batch_bytes,
                 configuration.scheduler.batch_timeout},
      heartbeat_{heartbeat_options(configuration, clock.now()), signer_, metrics_,
                 resources_} {}

void CollectorRuntime::start(const MonotonicTime now) {
    if (started_) {
        throw CollectorRuntimeError{"collector runtime is already started"};
    }
    const auto recovered_at = clock_.now();
    static_cast<void>(outbox_.recover(recovered_at));
    static_cast<void>(rejected_.recover(recovered_at));
    const auto checkpoint = checkpoints_.load();
    if (checkpoint.has_value() && checkpoint->collector_id != collector_id_) {
        throw CollectorRuntimeError{"checkpoint belongs to a different collector"};
    }

    for (const auto& source : source_settings_) {
        if (!source.enabled) {
            continue;
        }
        if (source.type != config::SourceType::file_drop) {
            throw CollectorRuntimeError{"runtime supports only enabled file_drop sources"};
        }
        auto options = ingress::FileReaderOptions{
            source.id,
            source.path,
            source.start_position,
            source.id,
            contract::ContractProfile::maximum_encoded_event_bytes,
            64U * 1024U,
            4U * 1024U * 1024U,
            resume_position(checkpoint, source.id)};
        sources_.push_back(SourceRuntime{
            source.id, std::make_unique<ingress::FileReader>(std::move(options), clock_)});
    }
    if (sources_.empty()) {
        throw CollectorRuntimeError{"collector runtime has no enabled sources"};
    }
    started_ = true;
    update_gauges();
    publish_heartbeat_if_due(now);
}

void CollectorRuntime::remember_error(const std::exception& error) {
    last_error_ = error.what();
}

void CollectorRuntime::update_gauges() {
    metrics_.update_queue(queue_.snapshot());
    try {
        metrics_.update_outbox(outbox_.usage());
    } catch (const std::exception& error) {
        metrics_.set_degradation(monitoring::DegradationSignal::publication_failure, true);
        remember_error(error);
    }
}

void CollectorRuntime::begin_batch(const MonotonicTime now) {
    assembler_.begin(pipeline::BatchDescriptor{identifiers_.next_uuid_v4(), collector_id_,
                                               clock_.now(), signer_.key_id()},
                     now);
}

bool CollectorRuntime::retry_pending_publication() {
    try {
        if (pending_batch_.has_value()) {
            const auto receipt = outbox_.publish_signed(*pending_batch_, clock_.now());
            metrics_.record_published(static_cast<std::uint64_t>(receipt.event_count),
                                      receipt.batch_id);
            pending_batch_.reset();
        } else if (pending_rejection_.has_value()) {
            static_cast<void>(
                rejected_.publish_signed(*pending_rejection_, clock_.now()));
            pending_rejection_.reset();
        }
        metrics_.set_degradation(monitoring::DegradationSignal::publication_failure, false);
        update_gauges();
        return true;
    } catch (const std::exception& error) {
        metrics_.set_degradation(monitoring::DegradationSignal::publication_failure, true);
        remember_error(error);
        update_gauges();
        return false;
    }
}

bool CollectorRuntime::flush_batch(const MonotonicTime now) {
    static_cast<void>(now);
    if (pending_batch_.has_value() || pending_rejection_.has_value()) {
        return retry_pending_publication();
    }
    if (assembler_.empty()) {
        return true;
    }
    auto batch = assembler_.seal();
    signer_.sign(batch);
    pending_batch_ = std::move(batch);
    return retry_pending_publication();
}

ingress::InputRejection CollectorRuntime::reject_event(
    const contract::ContractEvent& event, const contract::RejectionCode code,
    std::string message) const {
    constexpr std::size_t capture_limit = 64U * 1024U;
    const auto capture_size = std::min(event.raw_payload.size(), capture_limit);
    return ingress::InputRejection{
        code,
        std::move(message),
        event.source.source_id,
        event.source.adapter_type,
        event.source.position.value("file_identity", std::string{"unknown"}),
        event.source.position.value("record_start_offset", std::uint64_t{}),
        event.source.position.value("record_end_offset", std::uint64_t{}),
        event.content_type,
        static_cast<std::uint64_t>(event.raw_payload.size()),
        event.raw_payload.substr(0U, capture_size),
        event.raw_payload.size() > capture_size,
        security::sha256_hex(event.raw_payload)};
}

bool CollectorRuntime::drain_queue(const MonotonicTime now) {
    while (true) {
        std::optional<contract::ContractEvent> event;
        if (deferred_event_.has_value()) {
            event = std::move(*deferred_event_);
            deferred_event_.reset();
        } else {
            event = queue_.try_pop();
            metrics_.update_queue(queue_.snapshot());
        }
        if (!event.has_value()) {
            return true;
        }
        if (!assembler_.active()) {
            begin_batch(now);
        }
        const auto result = assembler_.try_add(*event);
        if (result == pipeline::BatchAddResult::accepted) {
            if (assembler_.full() && !flush_batch(now)) {
                return false;
            }
            continue;
        }
        if (result == pipeline::BatchAddResult::flush_required) {
            deferred_event_ = std::move(*event);
            if (!flush_batch(now)) {
                return false;
            }
            continue;
        }

        if (!assembler_.empty() && !flush_batch(now)) {
            deferred_event_ = std::move(*event);
            return false;
        }
        const auto code = result == pipeline::BatchAddResult::event_too_large
                              ? contract::RejectionCode::record_too_large
                              : contract::RejectionCode::ocsf_validation_failed;
        if (assembler_.active() && assembler_.empty()) {
            assembler_.discard_empty();
        }
        buffered_inputs_.push_front(reject_event(
            *event, code, "mapped event cannot be represented in a contract batch"));
        return true;
    }
}

bool CollectorRuntime::publish_rejection(ingress::InputRejection rejection) {
    if (rejection.payload_sha256.empty() && rejection.capture_truncated) {
        throw CollectorRuntimeError{
            "a truncated rejection must carry the SHA-256 of the complete payload"};
    }
    auto payload_sha256 =
        rejection.payload_sha256.empty() ? security::sha256_hex(rejection.capture)
                                         : std::move(rejection.payload_sha256);
    contract::RejectedEvent rejected;
    rejected.rejection_id = identifiers_.next_uuid_v4();
    rejected.collector_id = collector_id_;
    rejected.rejected_at = clock_.now();
    rejected.source = contract::RejectedSource{
        rejection.source_id, rejection.adapter_type, rejection.file_identity,
        rejection.record_start_offset, rejection.record_end_offset};
    rejected.rejection = contract::Rejection{contract::RejectionStage::input_validation,
                                             rejection.code,
                                             std::move(rejection.message)};
    rejected.payload = contract::RejectedPayload{
        std::move(rejection.content_type), rejection.byte_length,
        std::move(payload_sha256),
        "base64", security::base64_encode(rejection.capture),
        rejection.capture_truncated};
    signer_.sign(rejected);
    pending_rejection_ = std::move(rejected);
    metrics_.record_rejected();
    return retry_pending_publication();
}

bool CollectorRuntime::process_buffered_inputs(const MonotonicTime now) {
    while (!buffered_inputs_.empty()) {
        if (pending_batch_.has_value() || pending_rejection_.has_value()) {
            if (!retry_pending_publication()) {
                return false;
            }
        }
        if (std::holds_alternative<ingress::RawEvent>(buffered_inputs_.front())) {
            const auto mapped = mapper_.map(
                std::get<ingress::RawEvent>(buffered_inputs_.front()));
            if (std::holds_alternative<ingress::InputRejection>(mapped)) {
                buffered_inputs_.front() =
                    std::get<ingress::InputRejection>(std::move(mapped));
                continue;
            }
            buffered_inputs_.front() =
                std::get<contract::ContractEvent>(std::move(mapped));
            continue;
        }
        if (std::holds_alternative<ingress::InputRejection>(buffered_inputs_.front())) {
            if (!drain_queue(now) || !flush_batch(now)) {
                return false;
            }
            auto rejection =
                std::get<ingress::InputRejection>(std::move(buffered_inputs_.front()));
            buffered_inputs_.pop_front();
            if (!publish_rejection(std::move(rejection))) {
                return false;
            }
            continue;
        }

        const auto& event =
            std::get<contract::ContractEvent>(buffered_inputs_.front());
        const auto admitted = queue_.try_push(event);
        if (admitted == pipeline::AdmissionResult::accepted) {
            buffered_inputs_.pop_front();
            metrics_.update_queue(queue_.snapshot());
            continue;
        }
        if (admitted == pipeline::AdmissionResult::event_too_large) {
            auto rejection = reject_event(event, contract::RejectionCode::record_too_large,
                                          "mapped event exceeds the queue record limit");
            buffered_inputs_.front() = std::move(rejection);
            continue;
        }
        metrics_.set_degradation(monitoring::DegradationSignal::reliable_backpressure,
                                 true);
        if (!drain_queue(now) || !flush_batch(now)) {
            return false;
        }
    }
    return true;
}

void CollectorRuntime::publish_heartbeat_if_due(const MonotonicTime now) {
    try {
        static_cast<void>(heartbeat_.publish_if_due(now, clock_.now()));
    } catch (const std::exception& error) {
        remember_error(error);
    }
}

void CollectorRuntime::poll_once(const MonotonicTime now) {
    if (!started_ || stopping_) {
        throw CollectorRuntimeError{"collector runtime is not accepting poll cycles"};
    }
    if (!retry_pending_publication() || !process_buffered_inputs(now)) {
        publish_heartbeat_if_due(now);
        return;
    }

    for (auto& source : sources_) {
        try {
            auto result = source.reader->poll(scheduler_.batch_size);
            unavailable_sources_.erase(source.id);
            metrics_.set_degradation(monitoring::DegradationSignal::source_unavailable,
                                     !unavailable_sources_.empty());
            metrics_.record_received(static_cast<std::uint64_t>(result.items.size()));
            for (auto& item : result.items) {
                if (std::holds_alternative<ingress::RawEvent>(item)) {
                    buffered_inputs_.emplace_back(
                        std::get<ingress::RawEvent>(std::move(item)));
                } else {
                    buffered_inputs_.emplace_back(
                        std::get<ingress::InputRejection>(std::move(item)));
                }
            }
            if (!process_buffered_inputs(now)) {
                break;
            }
        } catch (const ingress::FileReaderError& error) {
            unavailable_sources_.insert(source.id);
            metrics_.set_degradation(monitoring::DegradationSignal::source_unavailable,
                                     true);
            remember_error(error);
        }
    }

    if (pending_batch_.has_value() || pending_rejection_.has_value() ||
        !buffered_inputs_.empty()) {
        update_gauges();
        publish_heartbeat_if_due(now);
        return;
    }
    if (!drain_queue(now)) {
        publish_heartbeat_if_due(now);
        return;
    }
    if (assembler_.should_flush(now)) {
        static_cast<void>(flush_batch(now));
    }
    update_gauges();
    publish_heartbeat_if_due(now);
}

void CollectorRuntime::shutdown(const MonotonicTime now) {
    if (!started_ || stopping_) {
        throw CollectorRuntimeError{"collector runtime cannot begin shutdown"};
    }
    stopping_ = true;
    if (!retry_pending_publication() || !process_buffered_inputs(now) ||
        !drain_queue(now) || !flush_batch(now) || pending_batch_.has_value() ||
        pending_rejection_.has_value() || deferred_event_.has_value() ||
        !buffered_inputs_.empty() || queue_.snapshot().events != 0U) {
        throw CollectorRuntimeError{
            "graceful shutdown could not durably publish all accepted records"};
    }
    update_gauges();
    static_cast<void>(heartbeat_.publish_shutdown(clock_.now()));
}

RuntimeSnapshot CollectorRuntime::snapshot() const {
    return RuntimeSnapshot{started_,
                           stopping_,
                           buffered_inputs_.size(),
                           pending_batch_.has_value() || pending_rejection_.has_value(),
                           queue_.snapshot(),
                           outbox_.usage(),
                           last_error_};
}

monitoring::OperationalSnapshot CollectorRuntime::operational_snapshot() {
    return metrics_.snapshot(resources_.sample());
}

const std::filesystem::path& CollectorRuntime::heartbeat_path() const noexcept {
    return heartbeat_.heartbeat_path();
}

} // namespace trivikrama::collector::runtime
