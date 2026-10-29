#include "trivikrama/collector/pipeline/bounded_event_queue.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"

#include <limits>
#include <stdexcept>
#include <utility>

namespace trivikrama::collector::pipeline {
namespace {

[[nodiscard]] bool add_overflows(const std::uint64_t left, const std::uint64_t right) noexcept {
    return right > std::numeric_limits<std::uint64_t>::max() - left;
}

} // namespace

BoundedEventQueue::BoundedEventQueue(const std::size_t maximum_events,
                                     const std::uint64_t maximum_bytes)
    : BoundedEventQueue{maximum_events, maximum_bytes, maximum_events, maximum_bytes} {}

BoundedEventQueue::BoundedEventQueue(const std::size_t maximum_events,
                                     const std::uint64_t maximum_bytes,
                                     const std::size_t maximum_events_per_source,
                                     const std::uint64_t maximum_bytes_per_source)
    : maximum_events_{maximum_events}, maximum_bytes_{maximum_bytes},
      maximum_events_per_source_{maximum_events_per_source},
      maximum_bytes_per_source_{maximum_bytes_per_source} {
    if (maximum_events_ == 0U || maximum_bytes_ == 0U) {
        throw std::invalid_argument{"queue event and byte limits must be positive"};
    }
    if (maximum_events_per_source_ == 0U ||
        maximum_events_per_source_ > maximum_events_ ||
        maximum_bytes_per_source_ == 0U ||
        maximum_bytes_per_source_ > maximum_bytes_) {
        throw std::invalid_argument{
            "per-source queue limits must be positive and within global limits"};
    }
}

std::uint64_t BoundedEventQueue::accounted_bytes(const contract::ContractEvent& event) {
    const auto json_bytes = event.ocsf.dump().size();
    std::uint64_t result = static_cast<std::uint64_t>(json_bytes);
    const std::string_view values[]{event.event_id,
                                    event.source.source_id,
                                    event.source.adapter_type,
                                    event.source.upstream_sender_id,
                                    event.source.original_endpoint_id,
                                    event.source.upstream_event_id,
                                    event.event_time,
                                    event.received_time,
                                    event.content_type,
                                    event.raw_payload};
    for (const auto value : values) {
        const auto size = static_cast<std::uint64_t>(value.size());
        if (add_overflows(result, size)) {
            throw std::overflow_error{"event byte accounting overflow"};
        }
        result += size;
    }
    const auto position_bytes = static_cast<std::uint64_t>(event.source.position.dump().size());
    if (add_overflows(result, position_bytes)) {
        throw std::overflow_error{"event byte accounting overflow"};
    }
    return result + position_bytes;
}

AdmissionResult BoundedEventQueue::try_push(contract::ContractEvent event) {
    const auto event_bytes = accounted_bytes(event);
    if (event.raw_payload.size() > contract::ContractProfile::maximum_encoded_event_bytes) {
        return AdmissionResult::event_too_large;
    }

    std::lock_guard lock{mutex_};
    if (entries_.size() >= maximum_events_) {
        return AdmissionResult::event_limit_reached;
    }
    if (event_bytes > maximum_bytes_ || add_overflows(bytes_, event_bytes) ||
        bytes_ + event_bytes > maximum_bytes_) {
        return AdmissionResult::byte_limit_reached;
    }
    const auto usage = source_usage_.find(event.source.source_id);
    if (usage != source_usage_.end() &&
        usage->second.events >= maximum_events_per_source_) {
        return AdmissionResult::source_event_limit_reached;
    }
    const auto source_bytes = usage == source_usage_.end() ? 0U : usage->second.bytes;
    if (event_bytes > maximum_bytes_per_source_ ||
        add_overflows(source_bytes, event_bytes) ||
        source_bytes + event_bytes > maximum_bytes_per_source_) {
        return AdmissionResult::source_byte_limit_reached;
    }
    auto source_id = event.source.source_id;
    entries_.push_back(Entry{std::move(event), source_id, event_bytes});
    bytes_ += event_bytes;
    auto& updated = source_usage_[source_id];
    ++updated.events;
    updated.bytes += event_bytes;
    return AdmissionResult::accepted;
}

std::optional<contract::ContractEvent> BoundedEventQueue::try_pop() {
    std::lock_guard lock{mutex_};
    if (entries_.empty()) {
        return std::nullopt;
    }
    auto entry = std::move(entries_.front());
    entries_.pop_front();
    bytes_ -= entry.bytes;
    auto usage = source_usage_.find(entry.source_id);
    if (usage == source_usage_.end() || usage->second.events == 0U ||
        usage->second.bytes < entry.bytes) {
        throw std::logic_error{"per-source queue accounting invariant failed"};
    }
    --usage->second.events;
    usage->second.bytes -= entry.bytes;
    if (usage->second.events == 0U) {
        source_usage_.erase(usage);
    }
    return std::move(entry.event);
}

QueueSnapshot BoundedEventQueue::snapshot() const {
    std::lock_guard lock{mutex_};
    return QueueSnapshot{entries_.size(), bytes_, maximum_events_, maximum_bytes_};
}

} // namespace trivikrama::collector::pipeline
