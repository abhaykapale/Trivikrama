#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/durability/checkpoint_store.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::durability {

struct OutboxPublisherOptions final {
    std::string collector_id;
    std::filesystem::path outbox_root;
    std::filesystem::path handoff_root;
    std::uint64_t maximum_bytes{};
    std::size_t maximum_batches{};
};

struct OutboxUsage final {
    std::uint64_t bytes{};
    std::size_t batches{};
};

struct PublishReceipt final {
    std::string batch_id;
    std::filesystem::path published_path;
    std::size_t event_count{};
    std::size_t encoded_bytes{};
};

struct RecoveryReport final {
    std::size_t published_batches{};
    std::size_t removed_temporary_files{};
};

class OutboxCapacityError final : public std::runtime_error {
  public:
    using std::runtime_error::runtime_error;
};

class OutboxPublisher final {
  public:
    OutboxPublisher(OutboxPublisherOptions options, CheckpointWriter& checkpoints);

    [[nodiscard]] PublishReceipt publish_signed(contract::EventBatch batch,
                                                const std::string& committed_at);
    [[nodiscard]] RecoveryReport recover(const std::string& recovered_at);
    [[nodiscard]] OutboxUsage usage() const;

    [[nodiscard]] const std::filesystem::path& outbox_directory() const noexcept {
        return outbox_directory_;
    }
    [[nodiscard]] const std::filesystem::path& handoff_directory() const noexcept {
        return handoff_directory_;
    }

  private:
    OutboxPublisherOptions options_;
    CheckpointWriter& checkpoints_;
    std::filesystem::path outbox_directory_;
    std::filesystem::path handoff_directory_;
    mutable std::mutex mutex_;
};

} // namespace trivikrama::collector::durability
