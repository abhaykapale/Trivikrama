#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/durability/checkpoint_store.hpp"

#include <cstddef>
#include <filesystem>
#include <mutex>
#include <string>

namespace trivikrama::collector::durability {

struct RejectedEventReceipt final {
    std::string rejection_id;
    std::filesystem::path published_path;
    std::size_t encoded_bytes{};
};

class RejectedEventPublisher final {
  public:
    RejectedEventPublisher(std::string collector_id, std::filesystem::path rejected_root,
                           CheckpointWriter& checkpoints);

    [[nodiscard]] RejectedEventReceipt publish_signed(
        const contract::RejectedEvent& rejected, const std::string& committed_at);
    [[nodiscard]] std::size_t recover(const std::string& recovered_at);

  private:
    std::string collector_id_;
    CheckpointWriter& checkpoints_;
    std::filesystem::path pending_directory_;
    std::filesystem::path records_directory_;
    std::mutex mutex_;
};

} // namespace trivikrama::collector::durability
