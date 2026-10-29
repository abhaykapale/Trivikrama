#pragma once

#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/durability/checkpoint_store.hpp"
#include "trivikrama/collector/durability/outbox_publisher.hpp"
#include "trivikrama/collector/durability/rejected_event_publisher.hpp"
#include "trivikrama/collector/ingress/file_reader.hpp"
#include "trivikrama/collector/monitoring/heartbeat_publisher.hpp"
#include "trivikrama/collector/monitoring/operational_metrics.hpp"
#include "trivikrama/collector/monitoring/resource_probe.hpp"
#include "trivikrama/collector/ocsf/baseline_mapper.hpp"
#include "trivikrama/collector/pipeline/batch_assembler.hpp"
#include "trivikrama/collector/pipeline/bounded_event_queue.hpp"
#include "trivikrama/collector/runtime/identifier_generator.hpp"
#include "trivikrama/collector/security/contract_signer.hpp"

#include <chrono>
#include <cstddef>
#include <deque>
#include <filesystem>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace trivikrama::collector::runtime {

class CollectorRuntimeError final : public std::runtime_error {
  public:
    using std::runtime_error::runtime_error;
};

struct RuntimeSnapshot final {
    bool started{};
    bool stopping{};
    std::size_t buffered_inputs{};
    bool pending_publication{};
    pipeline::QueueSnapshot queue;
    durability::OutboxUsage outbox;
    std::optional<std::string> last_error;
};

class CollectorRuntime final {
  public:
    using MonotonicTime = std::chrono::steady_clock::time_point;

    CollectorRuntime(const config::CollectorConfig& configuration,
                     ingress::IUtcClock& clock, IIdentifierGenerator& identifiers,
                     monitoring::IResourceProbe& resources);

    void start(MonotonicTime now);
    void poll_once(MonotonicTime now);
    void shutdown(MonotonicTime now);

    [[nodiscard]] RuntimeSnapshot snapshot() const;
    [[nodiscard]] monitoring::OperationalSnapshot operational_snapshot();
    [[nodiscard]] const std::filesystem::path& heartbeat_path() const noexcept;

  private:
    using PendingInput =
        std::variant<ingress::RawEvent, ingress::InputRejection,
                     contract::ContractEvent>;

    struct SourceRuntime final {
        std::string id;
        std::unique_ptr<ingress::FileReader> reader;
    };

    [[nodiscard]] bool process_buffered_inputs(MonotonicTime now);
    [[nodiscard]] bool drain_queue(MonotonicTime now);
    [[nodiscard]] bool flush_batch(MonotonicTime now);
    [[nodiscard]] bool retry_pending_publication();
    [[nodiscard]] bool publish_rejection(ingress::InputRejection rejection);
    void begin_batch(MonotonicTime now);
    void update_gauges();
    void publish_heartbeat_if_due(MonotonicTime now);
    void remember_error(const std::exception& error);
    [[nodiscard]] ingress::InputRejection reject_event(
        const contract::ContractEvent& event, contract::RejectionCode code,
        std::string message) const;

    std::string collector_id_;
    config::SchedulerSettings scheduler_;
    std::vector<config::SourceSettings> source_settings_;
    ingress::IUtcClock& clock_;
    IIdentifierGenerator& identifiers_;
    monitoring::IResourceProbe& resources_;
    security::ContractSigner signer_;
    durability::CheckpointStore checkpoints_;
    durability::OutboxPublisher outbox_;
    durability::RejectedEventPublisher rejected_;
    pipeline::BoundedEventQueue queue_;
    pipeline::BatchAssembler assembler_;
    monitoring::OperationalMetrics metrics_;
    monitoring::HeartbeatPublisher heartbeat_;
    ocsf::BaselineMapper mapper_;
    std::vector<SourceRuntime> sources_;
    std::deque<PendingInput> buffered_inputs_;
    std::optional<contract::ContractEvent> deferred_event_;
    std::optional<contract::EventBatch> pending_batch_;
    std::optional<contract::RejectedEvent> pending_rejection_;
    std::set<std::string, std::less<>> unavailable_sources_;
    std::optional<std::string> last_error_;
    bool started_{};
    bool stopping_{};
};

} // namespace trivikrama::collector::runtime
