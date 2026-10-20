#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/outbox_publisher.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::durability {
namespace {

class TemporaryDirectory final {
  public:
    TemporaryDirectory()
        : path_{std::filesystem::temp_directory_path() /
                ("trivikrama-outbox-" +
                 std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()))} {
        std::filesystem::create_directories(path_ / "outbox");
        std::filesystem::create_directories(path_ / "handoff");
    }
    ~TemporaryDirectory() { std::filesystem::remove_all(path_); }
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::filesystem::path path_;
};

class RecordingCheckpoint final : public CheckpointWriter {
  public:
    [[nodiscard]] std::optional<CheckpointState> load() const override { return state; }

    void commit(const std::string& collector_id,
                const CheckpointPublicationKind publication_kind,
                const std::string& publication_id,
                const std::string& committed_at,
                const SourcePositions& positions) override {
        if (!expected_published_path.empty()) {
            EXPECT_TRUE(std::filesystem::exists(expected_published_path));
        }
        if (fail_commit) {
            throw std::runtime_error{"injected checkpoint failure"};
        }
        state = CheckpointState{collector_id, committed_at, publication_kind,
                                publication_id, positions};
    }

    bool fail_commit{};
    std::filesystem::path expected_published_path;
    std::optional<CheckpointState> state;
};

[[nodiscard]] contract::EventBatch signed_batch(const std::string& batch_id) {
    contract::EventBatch batch;
    batch.batch_id = batch_id;
    batch.collector_id = "collector-01";
    batch.created_at = "2026-10-03T00:00:02Z";
    batch.integrity.key_id = "key-01";
    batch.integrity.value =
        std::string(contract::ContractProfile::encoded_signature_length, 'A');
    batch.events.push_back(contract::ContractEvent{
        "event-1",
        contract::EventSource{"source-1", "file_drop", "sender-1", "host-1", "upstream-1",
                              contract::Json{{"file_identity", "file-1"},
                                             {"record_start_offset", 0U},
                                             {"record_end_offset", 2U}}},
        "2026-10-03T00:00:00Z", "2026-10-03T00:00:01Z", "application/json", "{}",
        contract::Json{{"class_uid", 3002U}}});
    return batch;
}

[[nodiscard]] OutboxPublisher publisher(const TemporaryDirectory& temporary,
                                        RecordingCheckpoint& checkpoints,
                                        const std::size_t maximum_batches = 10U) {
    return OutboxPublisher{
        OutboxPublisherOptions{"collector-01", temporary.path() / "outbox",
                               temporary.path() / "handoff",
                               contract::ContractProfile::maximum_outbox_bytes,
                               maximum_batches},
        checkpoints};
}

TEST(OutboxPublisher, PublishesBeforeAdvancingCheckpoint) {
    const TemporaryDirectory temporary;
    RecordingCheckpoint checkpoints;
    auto outbox = publisher(temporary, checkpoints);
    const auto batch = signed_batch("123e4567-e89b-42d3-a456-426614174000");
    checkpoints.expected_published_path =
        outbox.handoff_directory() / ("batch_" + batch.batch_id + ".json");

    EXPECT_EQ(outbox.handoff_directory(),
              temporary.path() / "handoff/incoming/collector-01");

    const auto receipt = outbox.publish_signed(batch, "2026-10-03T00:00:03Z");

    EXPECT_EQ(receipt.published_path, checkpoints.expected_published_path);
    ASSERT_TRUE(checkpoints.state.has_value());
    EXPECT_EQ(checkpoints.state->last_publication_id, batch.batch_id);
    EXPECT_EQ(checkpoints.state->sources.at("source-1"),
              (contract::Json{{"file_identity", "file-1"}, {"end_offset", 2U}}));
    EXPECT_EQ(contract::parse_event_batch(
                  contract::serialize(batch, true), contract::SignatureRequirement::required),
              batch);
    EXPECT_EQ(outbox.usage().batches, 0U);
}

TEST(OutboxPublisher, RetainsSealedBatchWhenCheckpointCommitFailsAndRecoversIt) {
    const TemporaryDirectory temporary;
    RecordingCheckpoint checkpoints;
    auto outbox = publisher(temporary, checkpoints);
    const auto batch = signed_batch("123e4567-e89b-42d3-a456-426614174001");
    checkpoints.fail_commit = true;

    EXPECT_THROW(static_cast<void>(
                     outbox.publish_signed(batch, "2026-10-03T00:00:03Z")),
                 std::runtime_error);
    EXPECT_EQ(outbox.usage().batches, 1U);
    EXPECT_TRUE(std::filesystem::exists(outbox.handoff_directory() /
                                        ("batch_" + batch.batch_id + ".json")));

    checkpoints.fail_commit = false;
    const auto recovered = outbox.recover("2026-10-03T00:00:04Z");
    EXPECT_EQ(recovered.published_batches, 1U);
    EXPECT_EQ(outbox.usage().batches, 0U);
    ASSERT_TRUE(checkpoints.state.has_value());
    EXPECT_EQ(checkpoints.state->last_publication_id, batch.batch_id);
}

TEST(OutboxPublisher, RefusesUnsignedAndCapacityOverflowBatches) {
    const TemporaryDirectory temporary;
    RecordingCheckpoint checkpoints;
    auto outbox = publisher(temporary, checkpoints, 1U);
    auto unsigned_batch = signed_batch("123e4567-e89b-42d3-a456-426614174002");
    unsigned_batch.integrity.value.reset();
    EXPECT_THROW(static_cast<void>(outbox.publish_signed(
                     unsigned_batch, "2026-10-03T00:00:03Z")),
                 contract::ContractError);

    checkpoints.fail_commit = true;
    EXPECT_THROW(static_cast<void>(outbox.publish_signed(
                     signed_batch("123e4567-e89b-42d3-a456-426614174003"),
                     "2026-10-03T00:00:03Z")),
                 std::runtime_error);
    checkpoints.fail_commit = false;
    EXPECT_THROW(static_cast<void>(outbox.publish_signed(
                     signed_batch("123e4567-e89b-42d3-a456-426614174004"),
                     "2026-10-03T00:00:04Z")),
                 OutboxCapacityError);
}

} // namespace
} // namespace trivikrama::collector::durability
