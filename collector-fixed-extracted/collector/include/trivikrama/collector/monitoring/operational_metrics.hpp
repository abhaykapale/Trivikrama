#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/durability/outbox_publisher.hpp"
#include "trivikrama/collector/pipeline/bounded_event_queue.hpp"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>

namespace trivikrama::collector::monitoring {

enum class DegradationSignal : std::uint32_t {
    source_unavailable = 1U << 0U,
    reliable_backpressure = 1U << 1U,
    best_effort_loss = 1U << 2U,
    publication_failure = 1U << 3U,
    metric_saturation = 1U << 4U,
    heartbeat_publication_failure = 1U << 5U,
};

struct ResourceMetrics final {
    double cpu_percent{};
    std::uint64_t memory_bytes{};
    std::uint64_t disk_available_bytes{};
    bool complete{true};
};

struct OperationalSnapshot final {
    contract::HeartbeatMetrics metrics;
    bool active_degradation{};
};

class OperationalMetrics final {
  public:
    void record_received(std::uint64_t count = 1U) noexcept;
    void record_published(std::uint64_t event_count, std::string batch_id);
    void record_rejected(std::uint64_t count = 1U) noexcept;
    void record_best_effort_loss(std::uint64_t count = 1U) noexcept;

    void update_queue(const pipeline::QueueSnapshot& snapshot) noexcept;
    void update_outbox(const durability::OutboxUsage& usage) noexcept;
    void set_degradation(DegradationSignal signal, bool active) noexcept;

    [[nodiscard]] OperationalSnapshot snapshot(const ResourceMetrics& resources) const;

  private:
    void increment(std::atomic<std::uint64_t>& counter, std::uint64_t count) noexcept;

    std::atomic<std::uint64_t> events_received_{};
    std::atomic<std::uint64_t> events_published_{};
    std::atomic<std::uint64_t> events_rejected_{};
    std::atomic<std::uint64_t> events_lost_best_effort_{};
    std::atomic<std::uint64_t> queue_events_{};
    std::atomic<std::uint64_t> queue_bytes_{};
    std::atomic<std::uint64_t> outbox_batches_{};
    std::atomic<std::uint64_t> outbox_bytes_{};
    std::atomic<std::uint32_t> degradation_mask_{};
    mutable std::mutex last_batch_mutex_;
    std::optional<std::string> last_batch_id_;
};

} // namespace trivikrama::collector::monitoring
