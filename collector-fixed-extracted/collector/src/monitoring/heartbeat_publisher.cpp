#include "trivikrama/collector/monitoring/heartbeat_publisher.hpp"

#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <initializer_list>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace trivikrama::collector::monitoring {
namespace {

constexpr std::size_t maximum_sequence_state_bytes = 4096U;
constexpr std::uint64_t maximum_safe_integer = 9'007'199'254'740'991ULL;

void ensure_directory(const std::filesystem::path& path) {
    std::error_code error;
    std::filesystem::create_directories(path, error);
    if (error || !std::filesystem::is_directory(path, error) || error) {
        throw std::runtime_error{"cannot create heartbeat directory: " + path.string()};
    }
}

void require_exact_keys(const contract::Json& value,
                        const std::initializer_list<std::string_view> required) {
    if (!value.is_object()) {
        throw std::runtime_error{"heartbeat sequence state must be an object"};
    }
    for (const auto key : required) {
        if (!value.contains(std::string{key})) {
            throw std::runtime_error{"heartbeat sequence state is missing " +
                                     std::string{key}};
        }
    }
    for (const auto& [key, unused] : value.items()) {
        static_cast<void>(unused);
        if (std::none_of(required.begin(), required.end(),
                         [&key](const std::string_view expected) {
                             return key == expected;
                         })) {
            throw std::runtime_error{"heartbeat sequence state has unknown field " + key};
        }
    }
}

[[nodiscard]] std::uint64_t warning_threshold(const std::uint64_t maximum,
                                              const std::uint32_t percent) noexcept {
    return (maximum * percent + 99U) / 100U;
}

} // namespace

HeartbeatPublisher::HeartbeatPublisher(HeartbeatPublisherOptions options,
                                       const security::ContractSigner& signer,
                                       OperationalMetrics& metrics,
                                       IResourceProbe& resources)
    : options_{std::move(options)}, signer_{signer}, metrics_{metrics},
      resources_{resources},
      heartbeat_path_{options_.handoff_root / "incoming" / options_.collector_id /
                      "heartbeat.json"},
      sequence_state_path_{options_.state_root / options_.collector_id /
                           "heartbeat-sequence.json"} {
    if (options_.handoff_root.empty() || options_.state_root.empty() ||
        options_.handoff_root == options_.state_root) {
        throw std::invalid_argument{"heartbeat handoff and state roots must be distinct"};
    }
    if (options_.collector_version.empty() || options_.collector_version.size() > 64U ||
        options_.configuration_version.empty() ||
        options_.configuration_version.size() > 64U) {
        throw std::invalid_argument{
            "heartbeat version identifiers must contain 1-64 characters"};
    }
    if (options_.interval != contract::ContractProfile::heartbeat_interval) {
        throw std::invalid_argument{"heartbeat interval must be exactly 30 seconds"};
    }
    if (options_.maximum_outbox_bytes <
            contract::ContractProfile::maximum_encoded_batch_bytes ||
        options_.maximum_outbox_bytes > contract::ContractProfile::maximum_outbox_bytes ||
        options_.maximum_outbox_batches == 0U ||
        options_.maximum_outbox_batches > contract::ContractProfile::maximum_outbox_batches ||
        options_.outbox_warning_percent == 0U ||
        options_.outbox_warning_percent > 100U ||
        options_.minimum_disk_available_bytes == 0U) {
        throw std::invalid_argument{"heartbeat pressure thresholds are invalid"};
    }

    contract::Heartbeat probe;
    probe.collector_id = options_.collector_id;
    probe.timestamp = options_.started_at;
    probe.started_at = options_.started_at;
    probe.collector_version = options_.collector_version;
    probe.configuration_version = options_.configuration_version;
    probe.integrity.key_id = signer_.key_id();
    static_cast<void>(contract::serialize(probe, false));

    ensure_directory(heartbeat_path_.parent_path());
    ensure_directory(sequence_state_path_.parent_path());
    std::error_code error;
    const auto exists = std::filesystem::exists(sequence_state_path_, error);
    if (error) {
        throw std::runtime_error{"cannot inspect heartbeat sequence state: " +
                                 error.message()};
    }
    if (exists) {
        const auto document = contract::parse_json_strict(durability::read_file_bounded(
            sequence_state_path_, maximum_sequence_state_bytes));
        require_exact_keys(document, {"version", "collector_id", "next_sequence"});
        if (!document.at("version").is_number_unsigned() ||
            document.at("version").get<std::uint64_t>() != 1U ||
            !document.at("collector_id").is_string() ||
            document.at("collector_id").get<std::string>() != options_.collector_id ||
            !document.at("next_sequence").is_number_unsigned()) {
            throw std::runtime_error{"heartbeat sequence state is invalid"};
        }
        next_sequence_ = document.at("next_sequence").get<std::uint64_t>();
        if (next_sequence_ > maximum_safe_integer) {
            throw std::runtime_error{"heartbeat sequence exceeds the safe integer range"};
        }
    }
}

bool HeartbeatPublisher::due(const MonotonicTime now) const {
    std::lock_guard lock{mutex_};
    return !last_published_at_.has_value() || now - *last_published_at_ >= options_.interval;
}

std::optional<HeartbeatReceipt> HeartbeatPublisher::publish_if_due(
    const MonotonicTime now, const std::string& timestamp) {
    std::lock_guard lock{mutex_};
    if (last_published_at_.has_value() && now - *last_published_at_ < options_.interval) {
        return std::nullopt;
    }
    auto receipt = publish_locked(timestamp, false);
    last_published_at_ = now;
    return receipt;
}

HeartbeatReceipt HeartbeatPublisher::publish(const std::string& timestamp) {
    std::lock_guard lock{mutex_};
    return publish_locked(timestamp, false);
}

HeartbeatReceipt HeartbeatPublisher::publish_shutdown(const std::string& timestamp) {
    std::lock_guard lock{mutex_};
    return publish_locked(timestamp, true);
}

std::uint64_t HeartbeatPublisher::reserve_sequence() {
    if (next_sequence_ >= maximum_safe_integer) {
        throw std::runtime_error{"heartbeat sequence space is exhausted"};
    }
    const auto reserved = next_sequence_;
    ++next_sequence_;
    const contract::Json document{{"version", 1U},
                                  {"collector_id", options_.collector_id},
                                  {"next_sequence", next_sequence_}};
    auto temporary = sequence_state_path_;
    temporary += ".tmp";
    durability::write_file_durable(temporary, document.dump());
    durability::rename_durable(temporary, sequence_state_path_, true);
    return reserved;
}

bool HeartbeatPublisher::pressure_degraded(
    const contract::HeartbeatMetrics& metrics) const {
    return metrics.outbox_bytes >=
               warning_threshold(options_.maximum_outbox_bytes,
                                 options_.outbox_warning_percent) ||
           metrics.outbox_batches >=
               warning_threshold(static_cast<std::uint64_t>(options_.maximum_outbox_batches),
                                 options_.outbox_warning_percent) ||
           metrics.disk_available_bytes < options_.minimum_disk_available_bytes;
}

HeartbeatReceipt HeartbeatPublisher::publish_locked(const std::string& timestamp,
                                                    const bool shutting_down) {
    try {
        const auto sequence = reserve_sequence();
        auto snapshot = metrics_.snapshot(resources_.sample());
        contract::Heartbeat heartbeat;
        heartbeat.collector_id = options_.collector_id;
        heartbeat.sequence = sequence;
        heartbeat.timestamp = timestamp;
        heartbeat.started_at = options_.started_at;
        heartbeat.collector_version = options_.collector_version;
        heartbeat.configuration_version = options_.configuration_version;
        heartbeat.status = shutting_down
                               ? contract::HeartbeatStatus::shutting_down
                               : (snapshot.active_degradation ||
                                          pressure_degraded(snapshot.metrics)
                                      ? contract::HeartbeatStatus::degraded
                                      : contract::HeartbeatStatus::online);
        heartbeat.metrics = std::move(snapshot.metrics);
        signer_.sign(heartbeat);
        auto encoded = contract::serialize(heartbeat, true);
        auto temporary = heartbeat_path_;
        temporary += ".tmp";
        durability::write_file_durable(temporary, encoded);
        durability::rename_durable(temporary, heartbeat_path_, true);
        metrics_.set_degradation(DegradationSignal::heartbeat_publication_failure, false);
        return HeartbeatReceipt{std::move(heartbeat), heartbeat_path_, encoded.size()};
    } catch (...) {
        metrics_.set_degradation(DegradationSignal::heartbeat_publication_failure, true);
        throw;
    }
}

} // namespace trivikrama::collector::monitoring
