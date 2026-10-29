#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/monitoring/operational_metrics.hpp"
#include "trivikrama/collector/monitoring/resource_probe.hpp"
#include "trivikrama/collector/security/contract_signer.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>

namespace trivikrama::collector::monitoring {

struct HeartbeatPublisherOptions final {
    std::string collector_id;
    std::string collector_version;
    std::string configuration_version;
    std::string started_at;
    std::filesystem::path handoff_root;
    std::filesystem::path state_root;
    std::chrono::seconds interval{contract::ContractProfile::heartbeat_interval};
    std::uint64_t maximum_outbox_bytes{contract::ContractProfile::maximum_outbox_bytes};
    std::size_t maximum_outbox_batches{contract::ContractProfile::maximum_outbox_batches};
    std::uint32_t outbox_warning_percent{80U};
    std::uint64_t minimum_disk_available_bytes{
        contract::ContractProfile::maximum_encoded_batch_bytes};
};

struct HeartbeatReceipt final {
    contract::Heartbeat heartbeat;
    std::filesystem::path published_path;
    std::size_t encoded_bytes{};
};

class HeartbeatPublisher final {
  public:
    using MonotonicTime = std::chrono::steady_clock::time_point;

    HeartbeatPublisher(HeartbeatPublisherOptions options,
                       const security::ContractSigner& signer,
                       OperationalMetrics& metrics, IResourceProbe& resources);

    [[nodiscard]] bool due(MonotonicTime now) const;
    [[nodiscard]] std::optional<HeartbeatReceipt> publish_if_due(
        MonotonicTime now, const std::string& timestamp);
    [[nodiscard]] HeartbeatReceipt publish(const std::string& timestamp);
    [[nodiscard]] HeartbeatReceipt publish_shutdown(const std::string& timestamp);

    [[nodiscard]] const std::filesystem::path& heartbeat_path() const noexcept {
        return heartbeat_path_;
    }
    [[nodiscard]] const std::filesystem::path& sequence_state_path() const noexcept {
        return sequence_state_path_;
    }

  private:
    [[nodiscard]] HeartbeatReceipt publish_locked(const std::string& timestamp,
                                                  bool shutting_down);
    [[nodiscard]] std::uint64_t reserve_sequence();
    [[nodiscard]] bool pressure_degraded(const contract::HeartbeatMetrics& metrics) const;

    HeartbeatPublisherOptions options_;
    const security::ContractSigner& signer_;
    OperationalMetrics& metrics_;
    IResourceProbe& resources_;
    std::filesystem::path heartbeat_path_;
    std::filesystem::path sequence_state_path_;
    std::uint64_t next_sequence_{};
    std::optional<MonotonicTime> last_published_at_;
    mutable std::mutex mutex_;
};

} // namespace trivikrama::collector::monitoring
