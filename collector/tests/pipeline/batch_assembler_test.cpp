#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/pipeline/batch_assembler.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <cstddef>
#include <string>

namespace trivikrama::collector::pipeline {
namespace {

[[nodiscard]] contract::ContractEvent event(const std::string& id) {
    return contract::ContractEvent{
        id,
        contract::EventSource{"source-1", "file_drop", "sender-1", "host-1", id,
                              contract::Json{{"file_identity", "file-1"}, {"end_offset", 2U}}},
        "2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z", "application/json", "{}",
        contract::Json{{"class_uid", 3002U}}};
}

[[nodiscard]] contract::ContractEvent event_with_content(const std::string& id) {
    auto result = event(id);
    result.raw_payload =
        R"({"message":"quoted \"value\" and slash \\","unicode":"caf\u00e9 \ud83d\udd10"})";
    result.ocsf = contract::Json{{"class_uid", 3002U},
                                 {"message", "quoted \"value\" and slash \\; "
                                             "caf\xc3\xa9 \xf0\x9f\x94\x90"}};
    return result;
}

[[nodiscard]] BatchDescriptor descriptor() {
    return BatchDescriptor{"123e4567-e89b-42d3-a456-426614174000", "collector-01",
                           "2026-10-03T00:00:02Z", "key-01"};
}

[[nodiscard]] std::size_t serialized_signed_size(contract::EventBatch batch) {
    batch.integrity.value =
        std::string(contract::ContractProfile::encoded_signature_length, 'A');
    return contract::serialize(batch).size();
}

void expect_exact_accounting(const std::size_t count) {
    BatchAssembler assembler{contract::ContractProfile::maximum_events_per_batch,
                             contract::ContractProfile::maximum_encoded_batch_bytes,
                             std::chrono::seconds{5}};
    assembler.begin(descriptor(), BatchAssembler::MonotonicTime{});
    for (std::size_t index = 0U; index < count; ++index) {
        ASSERT_EQ(assembler.try_add(event("event-" + std::to_string(index))),
                  BatchAddResult::accepted);
    }

    const auto estimated = assembler.estimated_encoded_bytes();
    const auto batch = assembler.seal();
    EXPECT_EQ(batch.event_count(), count);
    EXPECT_EQ(serialized_signed_size(batch), estimated);
}

TEST(BatchAssembler, EnforcesCountAndAccountsForFinalSignature) {
    BatchAssembler assembler{1U, contract::ContractProfile::maximum_encoded_batch_bytes,
                             std::chrono::seconds{5}};
    const auto start = BatchAssembler::MonotonicTime{};
    assembler.begin(descriptor(), start);

    EXPECT_EQ(assembler.try_add(event("event-1")), BatchAddResult::accepted);
    EXPECT_EQ(assembler.try_add(event("event-2")), BatchAddResult::flush_required);
    EXPECT_TRUE(assembler.full());
    EXPECT_TRUE(assembler.should_flush(start + std::chrono::seconds{5}));

    const auto estimated = assembler.estimated_encoded_bytes();
    auto batch = assembler.seal();
    batch.integrity.value = std::string(contract::ContractProfile::encoded_signature_length, 'A');
    EXPECT_EQ(contract::serialize(batch).size(), estimated);
    EXPECT_EQ(batch.event_count(), 1U);
}

TEST(BatchAssembler, RefusesToSealEmptyBatch) {
    BatchAssembler assembler{10U, contract::ContractProfile::maximum_encoded_batch_bytes,
                             std::chrono::seconds{5}};
    assembler.begin(descriptor(), BatchAssembler::MonotonicTime{});
    EXPECT_THROW(static_cast<void>(assembler.seal()), BatchAssemblerError);
}

TEST(BatchAssembler, AccountsExactlyAcrossEventCountDigitBoundaries) {
    for (const auto count : {1U, 9U, 10U, 99U, 100U, 999U, 1000U}) {
        SCOPED_TRACE("event count: " + std::to_string(count));
        expect_exact_accounting(count);
    }
}

TEST(BatchAssembler, FlushesBeforeACountDigitBoundaryWouldExceedTheByteLimit) {
    BatchAssembler probe{10U, contract::ContractProfile::maximum_encoded_batch_bytes,
                         std::chrono::seconds{5}};
    probe.begin(descriptor(), BatchAssembler::MonotonicTime{});
    for (std::size_t index = 0U; index < 10U; ++index) {
        ASSERT_EQ(probe.try_add(event("event-" + std::to_string(index))),
                  BatchAddResult::accepted);
    }
    const auto ten_event_size = probe.estimated_encoded_bytes();
    EXPECT_NO_THROW(static_cast<void>(probe.seal()));

    BatchAssembler assembler{10U, ten_event_size - 1U, std::chrono::seconds{5}};
    assembler.begin(descriptor(), BatchAssembler::MonotonicTime{});
    for (std::size_t index = 0U; index < 9U; ++index) {
        ASSERT_EQ(assembler.try_add(event("event-" + std::to_string(index))),
                  BatchAddResult::accepted);
    }
    EXPECT_EQ(assembler.try_add(event("event-9")), BatchAddResult::flush_required);

    const auto estimated = assembler.estimated_encoded_bytes();
    const auto batch = assembler.seal();
    EXPECT_EQ(batch.event_count(), 9U);
    EXPECT_EQ(serialized_signed_size(batch), estimated);
}

TEST(BatchAssembler, AccountsForEscapedAndMultibyteUtf8Content) {
    BatchAssembler assembler{10U, contract::ContractProfile::maximum_encoded_batch_bytes,
                             std::chrono::seconds{5}};
    assembler.begin(descriptor(), BatchAssembler::MonotonicTime{});

    ASSERT_EQ(assembler.try_add(event_with_content("event-special-1")),
              BatchAddResult::accepted);
    ASSERT_EQ(assembler.try_add(event_with_content("event-special-2")),
              BatchAddResult::accepted);

    const auto estimated = assembler.estimated_encoded_bytes();
    const auto batch = assembler.seal();
    EXPECT_EQ(serialized_signed_size(batch), estimated);
}

TEST(BatchAssembler, EnforcesExactEncodedByteBoundary) {
    const auto candidate = event_with_content("event-boundary");
    BatchAssembler probe{1U, contract::ContractProfile::maximum_encoded_batch_bytes,
                         std::chrono::seconds{5}};
    probe.begin(descriptor(), BatchAssembler::MonotonicTime{});
    ASSERT_EQ(probe.try_add(candidate), BatchAddResult::accepted);
    const auto exact_size = probe.estimated_encoded_bytes();
    EXPECT_NO_THROW(static_cast<void>(probe.seal()));

    BatchAssembler exact{1U, exact_size, std::chrono::seconds{5}};
    exact.begin(descriptor(), BatchAssembler::MonotonicTime{});
    EXPECT_EQ(exact.try_add(candidate), BatchAddResult::accepted);
    EXPECT_NO_THROW(static_cast<void>(exact.seal()));

    BatchAssembler one_byte_short{1U, exact_size - 1U, std::chrono::seconds{5}};
    one_byte_short.begin(descriptor(), BatchAssembler::MonotonicTime{});
    EXPECT_EQ(one_byte_short.try_add(candidate), BatchAddResult::event_too_large);
}

} // namespace
} // namespace trivikrama::collector::pipeline
