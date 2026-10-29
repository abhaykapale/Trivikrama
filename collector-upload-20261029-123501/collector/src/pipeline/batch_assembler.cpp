#include "trivikrama/collector/pipeline/batch_assembler.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/contract/serialization.hpp"

#include <utility>

namespace trivikrama::collector::pipeline {
namespace {

[[nodiscard]] std::size_t signed_size(contract::EventBatch batch) {
    // Reserve the exact HMAC width so a batch accepted by this assembler cannot
    // grow beyond 8 MiB when the signer adds integrity.value.
    batch.integrity.value =
        std::string(contract::ContractProfile::encoded_signature_length, 'A');
    return contract::serialize(batch, true).size();
}

} // namespace

BatchAssembler::BatchAssembler(const std::size_t maximum_events,
                               const std::size_t maximum_encoded_bytes,
                               const std::chrono::seconds maximum_dwell_time)
    : maximum_events_{maximum_events}, maximum_encoded_bytes_{maximum_encoded_bytes},
      maximum_dwell_time_{maximum_dwell_time} {
    if (maximum_events_ == 0U ||
        maximum_events_ > contract::ContractProfile::maximum_events_per_batch) {
        throw std::invalid_argument{"batch event limit must be between 1 and 1000"};
    }
    if (maximum_encoded_bytes_ == 0U ||
        maximum_encoded_bytes_ > contract::ContractProfile::maximum_encoded_batch_bytes) {
        throw std::invalid_argument{"batch byte limit must be between 1 and 8 MiB"};
    }
    if (maximum_dwell_time_.count() <= 0 ||
        maximum_dwell_time_ > contract::ContractProfile::maximum_batch_dwell_time) {
        throw std::invalid_argument{"batch dwell time must be between 1 and 5 seconds"};
    }
}

void BatchAssembler::begin(BatchDescriptor descriptor, const MonotonicTime started_at) {
    if (batch_.has_value()) {
        throw BatchAssemblerError{"cannot begin while a batch is active"};
    }
    contract::EventBatch batch;
    batch.batch_id = std::move(descriptor.batch_id);
    batch.collector_id = std::move(descriptor.collector_id);
    batch.created_at = std::move(descriptor.created_at);
    batch.integrity.key_id = std::move(descriptor.key_id);
    empty_batch_bytes_ = signed_size(batch);
    if (empty_batch_bytes_ > maximum_encoded_bytes_) {
        throw BatchAssemblerError{"batch envelope exceeds the configured byte limit"};
    }
    encoded_bytes_ = empty_batch_bytes_;
    started_at_ = started_at;
    batch_ = std::move(batch);
}

std::size_t BatchAssembler::encoded_contribution(const contract::ContractEvent& event) const {
    auto one_event = *batch_;
    one_event.events.clear();
    one_event.events.push_back(event);
    const auto one_event_bytes = signed_size(std::move(one_event));
    if (one_event_bytes < empty_batch_bytes_) {
        throw BatchAssemblerError{"invalid serialized batch size"};
    }
    return one_event_bytes - empty_batch_bytes_;
}

BatchAddResult BatchAssembler::try_add(contract::ContractEvent event) {
    if (!batch_.has_value()) {
        throw BatchAssemblerError{"begin must be called before adding events"};
    }
    std::size_t contribution{};
    try {
        contribution = encoded_contribution(event);
    } catch (const contract::ContractError& error) {
        return error.code() == "record_too_large" ? BatchAddResult::event_too_large
                                                   : BatchAddResult::invalid_event;
    }
    if (contribution > maximum_encoded_bytes_ - empty_batch_bytes_) {
        return BatchAddResult::event_too_large;
    }
    const auto separator = batch_->events.empty() ? 0U : 1U;
    if (batch_->events.size() >= maximum_events_ ||
        encoded_bytes_ + separator > maximum_encoded_bytes_ ||
        contribution > maximum_encoded_bytes_ - encoded_bytes_ - separator) {
        return BatchAddResult::flush_required;
    }
    batch_->events.push_back(std::move(event));
    encoded_bytes_ += contribution + separator;
    return BatchAddResult::accepted;
}

bool BatchAssembler::should_flush(const MonotonicTime now) const noexcept {
    return batch_.has_value() && !batch_->events.empty() &&
           now - started_at_ >= maximum_dwell_time_;
}

bool BatchAssembler::active() const noexcept { return batch_.has_value(); }

bool BatchAssembler::full() const noexcept {
    return batch_.has_value() && batch_->events.size() >= maximum_events_;
}

bool BatchAssembler::empty() const noexcept {
    return !batch_.has_value() || batch_->events.empty();
}

std::size_t BatchAssembler::event_count() const noexcept {
    return batch_.has_value() ? batch_->events.size() : 0U;
}

std::size_t BatchAssembler::estimated_encoded_bytes() const noexcept { return encoded_bytes_; }

contract::EventBatch BatchAssembler::seal() {
    if (!batch_.has_value() || batch_->events.empty()) {
        throw BatchAssemblerError{"cannot seal an empty batch"};
    }
    const auto actual_bytes = signed_size(*batch_);
    if (actual_bytes != encoded_bytes_ || actual_bytes > maximum_encoded_bytes_) {
        throw BatchAssemblerError{"batch byte accounting invariant failed"};
    }
    auto result = std::move(*batch_);
    batch_.reset();
    empty_batch_bytes_ = 0U;
    encoded_bytes_ = 0U;
    return result;
}

void BatchAssembler::discard_empty() {
    if (!batch_.has_value() || !batch_->events.empty()) {
        throw BatchAssemblerError{"only an active empty batch can be discarded"};
    }
    batch_.reset();
    empty_batch_bytes_ = 0U;
    encoded_bytes_ = 0U;
}

} // namespace trivikrama::collector::pipeline
