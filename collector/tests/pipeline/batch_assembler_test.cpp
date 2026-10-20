#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/pipeline/batch_assembler.hpp"

#include <gtest/gtest.h>

#include <chrono>
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

[[nodiscard]] BatchDescriptor descriptor() {
    return BatchDescriptor{"123e4567-e89b-42d3-a456-426614174000", "collector-01",
                           "2026-10-03T00:00:02Z", "key-01"};
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

} // namespace
} // namespace trivikrama::collector::pipeline
