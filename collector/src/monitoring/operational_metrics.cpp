#include "trivikrama/collector/monitoring/operational_metrics.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>

namespace trivikrama::collector::monitoring {
namespace {

constexpr std::uint64_t maximum_safe_counter = 9'007'199'254'740'991ULL;

[[nodiscard]] std::uint64_t bounded_size(const std::size_t value) noexcept {
    if constexpr (sizeof(std::size_t) > sizeof(std::uint64_t)) {
        return value > maximum_safe_counter ? maximum_safe_counter
                                            : static_cast<std::uint64_t>(value);
    }
    return std::min(static_cast<std::uint64_t>(value), maximum_safe_counter);
}

[[nodiscard]] std::uint32_t bit(const DegradationSignal signal) noexcept {
    return static_cast<std::uint32_t>(signal);
}

} // namespace

void OperationalMetrics::increment(std::atomic<std::uint64_t>& counter,
                                   const std::uint64_t count) noexcept {
    auto current = counter.load(std::memory_order_relaxed);
    while (true) {
        const auto next = count > maximum_safe_counter - current
                              ? maximum_safe_counter
                              : current + count;
        if (counter.compare_exchange_weak(current, next, std::memory_order_relaxed)) {
            if (next == maximum_safe_counter && count != 0U) {
                degradation_mask_.fetch_or(bit(DegradationSignal::metric_saturation),
                                           std::memory_order_relaxed);
            }
            return;
        }
    }
}

void OperationalMetrics::record_received(const std::uint64_t count) noexcept {
    increment(events_received_, count);
}

void OperationalMetrics::record_published(const std::uint64_t event_count,
                                          std::string batch_id) {
    increment(events_published_, event_count);
    if (!batch_id.empty()) {
        std::lock_guard lock{last_batch_mutex_};
        last_batch_id_ = std::move(batch_id);
    }
}

void OperationalMetrics::record_rejected(const std::uint64_t count) noexcept {
    increment(events_rejected_, count);
}

void OperationalMetrics::record_best_effort_loss(const std::uint64_t count) noexcept {
    increment(events_lost_best_effort_, count);
    if (count != 0U) {
        set_degradation(DegradationSignal::best_effort_loss, true);
    }
}

void OperationalMetrics::update_queue(const pipeline::QueueSnapshot& snapshot) noexcept {
    queue_events_.store(bounded_size(snapshot.events), std::memory_order_relaxed);
    queue_bytes_.store(std::min(snapshot.bytes, maximum_safe_counter),
                       std::memory_order_relaxed);
    const auto saturated = snapshot.events >= snapshot.maximum_events ||
                           snapshot.bytes >= snapshot.maximum_bytes;
    set_degradation(DegradationSignal::reliable_backpressure, saturated);
}

void OperationalMetrics::update_outbox(const durability::OutboxUsage& usage) noexcept {
    outbox_batches_.store(bounded_size(usage.batches), std::memory_order_relaxed);
    outbox_bytes_.store(std::min(usage.bytes, maximum_safe_counter),
                        std::memory_order_relaxed);
}

void OperationalMetrics::set_degradation(const DegradationSignal signal,
                                         const bool active) noexcept {
    if (active) {
        degradation_mask_.fetch_or(bit(signal), std::memory_order_relaxed);
    } else {
        degradation_mask_.fetch_and(~bit(signal), std::memory_order_relaxed);
    }
}

OperationalSnapshot OperationalMetrics::snapshot(const ResourceMetrics& resources) const {
    contract::HeartbeatMetrics metrics;
    metrics.events_received = events_received_.load(std::memory_order_relaxed);
    metrics.events_published = events_published_.load(std::memory_order_relaxed);
    metrics.events_rejected = events_rejected_.load(std::memory_order_relaxed);
    metrics.events_lost_best_effort =
        events_lost_best_effort_.load(std::memory_order_relaxed);
    metrics.queue_events = queue_events_.load(std::memory_order_relaxed);
    metrics.queue_bytes = queue_bytes_.load(std::memory_order_relaxed);
    metrics.outbox_batches = outbox_batches_.load(std::memory_order_relaxed);
    metrics.outbox_bytes = outbox_bytes_.load(std::memory_order_relaxed);
    {
        std::lock_guard lock{last_batch_mutex_};
        metrics.last_batch_id = last_batch_id_;
    }
    const auto cpu_valid = std::isfinite(resources.cpu_percent) &&
                           resources.cpu_percent >= 0.0 &&
                           resources.cpu_percent <= 100.0;
    metrics.cpu_percent = cpu_valid ? resources.cpu_percent : 0.0;
    metrics.memory_bytes = std::min(resources.memory_bytes, maximum_safe_counter);
    metrics.disk_available_bytes =
        std::min(resources.disk_available_bytes, maximum_safe_counter);
    return OperationalSnapshot{
        std::move(metrics),
        degradation_mask_.load(std::memory_order_relaxed) != 0U || !resources.complete ||
            !cpu_valid || resources.memory_bytes > maximum_safe_counter ||
            resources.disk_available_bytes > maximum_safe_counter};
}

} // namespace trivikrama::collector::monitoring
