#include "trivikrama/collector/monitoring/operational_metrics.hpp"

#include <gtest/gtest.h>

#include <cstdint>
#include <limits>

namespace trivikrama::collector::monitoring {
namespace {

constexpr std::uint64_t maximum_safe_counter = 9'007'199'254'740'991ULL;

TEST(OperationalMetrics, PublishesCounterGaugeAndLastBatchSnapshot) {
    OperationalMetrics metrics;
    metrics.record_received(12U);
    metrics.record_published(10U, "123e4567-e89b-42d3-a456-426614174000");
    metrics.record_rejected(2U);
    metrics.update_queue(pipeline::QueueSnapshot{3U, 400U, 10U, 1000U});
    metrics.update_outbox(durability::OutboxUsage{500U, 2U});

    const auto snapshot = metrics.snapshot(ResourceMetrics{12.5, 4096U, 8192U, true});

    EXPECT_EQ(snapshot.metrics.events_received, 12U);
    EXPECT_EQ(snapshot.metrics.events_published, 10U);
    EXPECT_EQ(snapshot.metrics.events_rejected, 2U);
    EXPECT_EQ(snapshot.metrics.queue_events, 3U);
    EXPECT_EQ(snapshot.metrics.queue_bytes, 400U);
    EXPECT_EQ(snapshot.metrics.outbox_batches, 2U);
    EXPECT_EQ(snapshot.metrics.outbox_bytes, 500U);
    ASSERT_TRUE(snapshot.metrics.last_batch_id.has_value());
    EXPECT_EQ(*snapshot.metrics.last_batch_id,
              "123e4567-e89b-42d3-a456-426614174000");
    EXPECT_FALSE(snapshot.active_degradation);
}

TEST(OperationalMetrics, TracksAndClearsActiveDegradationSignals) {
    OperationalMetrics metrics;
    metrics.update_queue(pipeline::QueueSnapshot{10U, 100U, 10U, 1000U});
    EXPECT_TRUE(metrics.snapshot(ResourceMetrics{}).active_degradation);

    metrics.update_queue(pipeline::QueueSnapshot{1U, 100U, 10U, 1000U});
    EXPECT_FALSE(metrics.snapshot(ResourceMetrics{}).active_degradation);

    metrics.record_best_effort_loss(3U);
    EXPECT_TRUE(metrics.snapshot(ResourceMetrics{}).active_degradation);
    metrics.set_degradation(DegradationSignal::best_effort_loss, false);
    const auto recovered = metrics.snapshot(ResourceMetrics{});
    EXPECT_FALSE(recovered.active_degradation);
    EXPECT_EQ(recovered.metrics.events_lost_best_effort, 3U);
}

TEST(OperationalMetrics, SaturatesCountersWithoutWrapping) {
    OperationalMetrics metrics;
    metrics.record_received(maximum_safe_counter);
    metrics.record_received(1U);

    const auto snapshot = metrics.snapshot(ResourceMetrics{});
    EXPECT_EQ(snapshot.metrics.events_received, maximum_safe_counter);
    EXPECT_TRUE(snapshot.active_degradation);
}

TEST(OperationalMetrics, MarksIncompleteResourceSamplingAsDegraded) {
    OperationalMetrics metrics;
    const auto snapshot = metrics.snapshot(ResourceMetrics{0.0, 0U, 0U, false});
    EXPECT_TRUE(snapshot.active_degradation);

    const auto invalid_cpu = metrics.snapshot(ResourceMetrics{
        std::numeric_limits<double>::quiet_NaN(), 1U, 1U, true});
    EXPECT_TRUE(invalid_cpu.active_degradation);
    EXPECT_EQ(invalid_cpu.metrics.cpu_percent, 0.0);
}

} // namespace
} // namespace trivikrama::collector::monitoring
