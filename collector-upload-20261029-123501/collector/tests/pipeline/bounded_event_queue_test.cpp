#include "trivikrama/collector/pipeline/bounded_event_queue.hpp"

#include <gtest/gtest.h>

#include <string>

namespace trivikrama::collector::pipeline {
namespace {

[[nodiscard]] contract::ContractEvent event(std::string id, std::string payload = "{}") {
    return contract::ContractEvent{
        std::move(id),
        contract::EventSource{"source-1", "file_drop", "sender-1", "host-1", "upstream-1",
                              contract::Json{{"file_identity", "file-1"}, {"end_offset", 2U}}},
        "2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z", "application/json",
        std::move(payload), contract::Json{{"class_uid", 3002U}}};
}

TEST(BoundedEventQueue, AppliesBackpressureWithoutDroppingOldestEvent) {
    BoundedEventQueue queue{1U, 1024U * 1024U};

    EXPECT_EQ(queue.try_push(event("first")), AdmissionResult::accepted);
    EXPECT_EQ(queue.try_push(event("second")), AdmissionResult::event_limit_reached);

    const auto popped = queue.try_pop();
    ASSERT_TRUE(popped.has_value());
    EXPECT_EQ(popped->event_id, "first");
    EXPECT_EQ(queue.snapshot().events, 0U);
    EXPECT_EQ(queue.snapshot().bytes, 0U);
}

TEST(BoundedEventQueue, EnforcesByteLimitAndContractRecordLimit) {
    const auto small = event("small");
    const auto bytes = BoundedEventQueue::accounted_bytes(small);
    BoundedEventQueue queue{10U, bytes};

    EXPECT_EQ(queue.try_push(small), AdmissionResult::accepted);
    EXPECT_EQ(queue.try_push(event("other")), AdmissionResult::byte_limit_reached);
    EXPECT_EQ(queue.try_push(event("large", std::string(512U * 1024U + 1U, 'x'))),
              AdmissionResult::event_too_large);
}

TEST(BoundedEventQueue, PreventsOneSourceFromConsumingTheWholeQueue) {
    BoundedEventQueue queue{4U, 1024U * 1024U, 1U, 512U * 1024U};
    EXPECT_EQ(queue.try_push(event("source-one")), AdmissionResult::accepted);
    EXPECT_EQ(queue.try_push(event("source-one-again")),
              AdmissionResult::source_event_limit_reached);

    auto another = event("source-two");
    another.source.source_id = "source-2";
    EXPECT_EQ(queue.try_push(std::move(another)), AdmissionResult::accepted);
}

} // namespace
} // namespace trivikrama::collector::pipeline
