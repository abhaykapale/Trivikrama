#include "trivikrama/collector/durability/rejected_event_publisher.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::durability {
namespace {

class RejectionCheckpoint final : public CheckpointWriter {
  public:
    [[nodiscard]] std::optional<CheckpointState> load() const override { return state; }
    void commit(const std::string& collector_id,
                const CheckpointPublicationKind publication_kind,
                const std::string& publication_id, const std::string& committed_at,
                const SourcePositions& positions) override {
        if (fail) {
            throw std::runtime_error{"injected failure"};
        }
        state = CheckpointState{collector_id, committed_at, publication_kind,
                                publication_id, positions};
    }
    bool fail{};
    std::optional<CheckpointState> state;
};

[[nodiscard]] contract::RejectedEvent rejected_event() {
    contract::RejectedEvent rejected;
    rejected.rejection_id = "123e4567-e89b-42d3-a456-426614174010";
    rejected.collector_id = "collector-01";
    rejected.rejected_at = "2026-10-03T00:00:01Z";
    rejected.source = contract::RejectedSource{"source-1", "file_drop", "file-1", 0U, 2U};
    rejected.rejection = contract::Rejection{contract::RejectionStage::input_validation,
                                             contract::RejectionCode::invalid_json,
                                             "invalid input"};
    rejected.payload = contract::RejectedPayload{"application/json", 2U,
                                                  std::string(64U, 'a'), "base64", "e30=",
                                                  false};
    rejected.integrity.key_id = "key-01";
    rejected.integrity.value =
        std::string(contract::ContractProfile::encoded_signature_length, 'A');
    return rejected;
}

TEST(RejectedEventPublisher, RecoversPublishedRejectionBeforeAdvancingPosition) {
    const auto root = std::filesystem::temp_directory_path() /
                      ("trivikrama-rejected-" + std::to_string(
                           std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(root);
    RejectionCheckpoint checkpoint;
    RejectedEventPublisher publisher{"collector-01", root, checkpoint};
    const auto rejected = rejected_event();
    checkpoint.fail = true;
    EXPECT_THROW(static_cast<void>(publisher.publish_signed(
                     rejected, "2026-10-03T00:00:02Z")),
                 std::runtime_error);

    checkpoint.fail = false;
    EXPECT_EQ(publisher.recover("2026-10-03T00:00:03Z"), 1U);
    ASSERT_TRUE(checkpoint.state.has_value());
    EXPECT_EQ(checkpoint.state->last_publication_kind,
              CheckpointPublicationKind::rejected_event);
    EXPECT_EQ(checkpoint.state->last_publication_id, rejected.rejection_id);
    std::filesystem::remove_all(root);
}

} // namespace
} // namespace trivikrama::collector::durability
