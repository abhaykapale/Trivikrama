#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/checkpoint_store.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"
#include "trivikrama/collector/monitoring/resource_probe.hpp"
#include "trivikrama/collector/runtime/collector_runtime.hpp"
#include "trivikrama/collector/runtime/identifier_generator.hpp"
#include "trivikrama/collector/security/contract_signer.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace trivikrama::collector::runtime {
namespace {

class TemporaryWorkspace final {
  public:
    TemporaryWorkspace()
        : path_{std::filesystem::temp_directory_path() /
                ("trivikrama-runtime-" + std::to_string(
                     std::chrono::steady_clock::now().time_since_epoch().count()))} {
        std::filesystem::create_directories(path_ / "handoff");
        std::filesystem::create_directories(path_ / "state");
        std::filesystem::create_directories(path_ / "outbox");
        std::filesystem::create_directories(path_ / "rejected");
        std::filesystem::create_directories(path_ / "logs");
        std::filesystem::create_directories(path_ / "mappings");
    }
    ~TemporaryWorkspace() { std::filesystem::remove_all(path_); }

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }
    [[nodiscard]] std::filesystem::path input_path() const { return path_ / "input.jsonl"; }

    void write_input(const std::string& contents) const {
        std::ofstream output{input_path(), std::ios::binary | std::ios::trunc};
        output << contents;
    }

    void append_input(const std::string& contents) const {
        std::ofstream output{input_path(), std::ios::binary | std::ios::app};
        output << contents;
    }

  private:
    std::filesystem::path path_;
};

class FixedClock final : public ingress::IUtcClock {
  public:
    [[nodiscard]] std::string now() const override { return value; }
    std::string value{"2026-10-03T20:30:00Z"};
};

class FixedResources final : public monitoring::IResourceProbe {
  public:
    [[nodiscard]] monitoring::ResourceMetrics sample() override {
        return {5.0, 16U * 1024U * 1024U, 2U * 1024U * 1024U * 1024U, true};
    }
};

class DeterministicIdentifiers final : public IIdentifierGenerator {
  public:
    explicit DeterministicIdentifiers(std::uint32_t first) : next_{first} {}

    [[nodiscard]] std::string next_uuid_v4() override {
        const auto suffix = next_++;
        auto value = std::to_string(suffix);
        value.insert(value.begin(), 12U - value.size(), '0');
        return "123e4567-e89b-42d3-a456-" + value;
    }

  private:
    std::uint32_t next_;
};

[[nodiscard]] std::string valid_event(const std::string& event_id,
                                      const std::string& username = "analyst") {
    return "{\"event_id\":\"" + event_id +
           "\",\"endpoint_id\":\"endpoint-01\",\"event_type\":\"login_failed\","
           "\"timestamp\":\"2026-10-03T20:29:59Z\",\"username\":\"" + username +
           "\",\"source_ip\":\"192.0.2.10\"}\n";
}

[[nodiscard]] config::CollectorConfig configuration(const TemporaryWorkspace& workspace,
                                                    const std::size_t batch_size = 1000U,
                                                    const std::uint64_t outbox_bytes =
                                                        10ULL * 1024ULL * 1024ULL * 1024ULL) {
    return config::CollectorConfig{
        config::CollectorSettings{"collector-runtime-01", "runtime-test-v1",
                                  config::LogLevel::info, config::LogFormat::json,
                                  workspace.path() / "logs/collector.log", 10U, 5U},
        config::OutputSettings{workspace.path() / "handoff", workspace.path() / "state",
                               workspace.path() / "outbox", workspace.path() / "rejected",
                               workspace.path() / "state/checkpoint.json",
                               std::chrono::seconds{30}},
        config::SchedulerSettings{std::chrono::milliseconds{1}, batch_size,
                                  std::chrono::seconds{5}, 1000U,
                                  16U * 1024U * 1024U},
        config::OutboxSettings{outbox_bytes, 100U, 80U, 95U},
        std::vector<config::SourceSettings>{config::SourceSettings{
            "simulated_auth_input", config::SourceType::file_drop, true,
            workspace.input_path(), config::StartPosition::oldest}},
        config::OcsfSettings{std::string{contract::ContractProfile::ocsf_schema_version},
                             config::UnknownFieldPolicy::unmapped,
                             workspace.path() / "mappings"},
        config::SecuritySettings{"runtime-key-01",
                                 config::SecretValue{std::string(64U, 'A')}}};
}

[[nodiscard]] std::vector<std::filesystem::path> json_files(
    const std::filesystem::path& directory) {
    std::vector<std::filesystem::path> result;
    std::error_code error;
    for (std::filesystem::directory_iterator iterator{directory, error}, end;
         !error && iterator != end; iterator.increment(error)) {
        if (iterator->is_regular_file(error) && !error &&
            iterator->path().extension() == ".json") {
            result.push_back(iterator->path());
        }
    }
    if (error) {
        throw std::runtime_error{"cannot inspect test directory"};
    }
    return result;
}

[[nodiscard]] std::vector<contract::EventBatch> read_batches(
    const TemporaryWorkspace& workspace) {
    std::vector<contract::EventBatch> result;
    for (const auto& path : json_files(workspace.path() /
                                       "handoff/incoming/collector-runtime-01")) {
        if (!path.filename().string().starts_with("batch_")) {
            continue;
        }
        result.push_back(contract::parse_event_batch(
            durability::read_file_bounded(
                path, contract::ContractProfile::maximum_encoded_batch_bytes)));
    }
    return result;
}

TEST(CollectorRuntime, ComposesSignedPipelineMetricsCheckpointAndShutdownHeartbeat) {
    TemporaryWorkspace workspace;
    workspace.write_input(valid_event("auth-0001") + valid_event("auth-0002") +
                          valid_event("auth-0003"));
    auto config = configuration(workspace);
    FixedClock clock;
    FixedResources resources;
    DeterministicIdentifiers identifiers{1U};
    CollectorRuntime runtime{config, clock, identifiers, resources};
    const auto started = CollectorRuntime::MonotonicTime{};

    runtime.start(started);
    runtime.poll_once(started);
    runtime.shutdown(started + std::chrono::seconds{1});

    const auto batches = read_batches(workspace);
    ASSERT_EQ(batches.size(), 1U);
    EXPECT_EQ(batches.front().event_count(), 3U);
    security::ContractSigner verifier{config.security.key_id, config.security.hmac_secret};
    EXPECT_TRUE(verifier.verify(batches.front()));

    durability::CheckpointStore checkpoints{config.output.checkpoint_file};
    const auto checkpoint = checkpoints.load();
    ASSERT_TRUE(checkpoint.has_value());
    EXPECT_EQ(checkpoint->sources.at("simulated_auth_input").at("end_offset"),
              std::filesystem::file_size(workspace.input_path()));

    const auto heartbeat = contract::parse_heartbeat(durability::read_file_bounded(
        runtime.heartbeat_path(), 1024U * 1024U));
    EXPECT_EQ(heartbeat.status, contract::HeartbeatStatus::shutting_down);
    EXPECT_EQ(heartbeat.metrics.events_received, 3U);
    EXPECT_EQ(heartbeat.metrics.events_published, 3U);
    EXPECT_TRUE(verifier.verify(heartbeat));
}

TEST(CollectorRuntime, PreservesPublicationOrderAcrossRejectedInput) {
    TemporaryWorkspace workspace;
    workspace.write_input(valid_event("auth-0001") + "{not-json}\n" +
                          valid_event("auth-0002"));
    auto config = configuration(workspace);
    FixedClock clock;
    FixedResources resources;
    DeterministicIdentifiers identifiers{10U};
    CollectorRuntime runtime{config, clock, identifiers, resources};
    const auto started = CollectorRuntime::MonotonicTime{};

    runtime.start(started);
    runtime.poll_once(started);
    runtime.shutdown(started + std::chrono::seconds{1});

    EXPECT_EQ(read_batches(workspace).size(), 2U);
    const auto rejected = json_files(workspace.path() /
                                     "rejected/collector-runtime-01/records");
    ASSERT_EQ(rejected.size(), 1U);
    const auto record = contract::parse_rejected_event(durability::read_file_bounded(
        rejected.front(), contract::ContractProfile::maximum_encoded_event_bytes));
    EXPECT_EQ(record.rejection.code, contract::RejectionCode::invalid_json);
    EXPECT_EQ(record.payload.byte_length, 10U);
    EXPECT_FALSE(record.payload.sha256.empty());
}

TEST(CollectorRuntime, RestartsFromCommittedFileCheckpointWithoutReplay) {
    TemporaryWorkspace workspace;
    workspace.write_input(valid_event("auth-0001"));
    auto config = configuration(workspace);
    FixedClock clock;
    FixedResources resources;
    const auto started = CollectorRuntime::MonotonicTime{};
    {
        DeterministicIdentifiers identifiers{20U};
        CollectorRuntime runtime{config, clock, identifiers, resources};
        runtime.start(started);
        runtime.poll_once(started);
        runtime.shutdown(started + std::chrono::seconds{1});
    }

    workspace.append_input(valid_event("auth-0002"));
    clock.value = "2026-10-03T20:31:00Z";
    {
        DeterministicIdentifiers identifiers{30U};
        CollectorRuntime runtime{config, clock, identifiers, resources};
        runtime.start(started + std::chrono::seconds{60});
        runtime.poll_once(started + std::chrono::seconds{60});
        runtime.shutdown(started + std::chrono::seconds{61});
    }

    const auto batches = read_batches(workspace);
    ASSERT_EQ(batches.size(), 2U);
    for (const auto& batch : batches) {
        EXPECT_EQ(batch.event_count(), 1U);
    }
}

TEST(CollectorRuntime, RetriesSameSealedBatchAfterCheckpointFault) {
    TemporaryWorkspace workspace;
    workspace.write_input(valid_event("auth-0001"));
    auto config = configuration(workspace, 1U);
    FixedClock clock;
    FixedResources resources;
    DeterministicIdentifiers identifiers{40U};
    std::filesystem::create_directory(
        std::filesystem::path{config.output.checkpoint_file.string() + ".tmp"});
    CollectorRuntime runtime{config, clock, identifiers, resources};
    const auto started = CollectorRuntime::MonotonicTime{};

    runtime.start(started);
    runtime.poll_once(started);
    EXPECT_TRUE(runtime.snapshot().pending_publication);
    EXPECT_FALSE(std::filesystem::exists(config.output.checkpoint_file));
    EXPECT_TRUE(runtime.operational_snapshot().active_degradation);

    std::filesystem::remove_all(config.output.checkpoint_file.string() + ".tmp");
    runtime.poll_once(started + std::chrono::seconds{1});
    EXPECT_FALSE(runtime.snapshot().pending_publication);
    EXPECT_TRUE(std::filesystem::exists(config.output.checkpoint_file));
    runtime.shutdown(started + std::chrono::seconds{2});
    EXPECT_EQ(read_batches(workspace).size(), 1U);
}

TEST(CollectorRuntime, RetainsPendingBatchWhenOutboxCapacityIsExhausted) {
    TemporaryWorkspace workspace;
    workspace.write_input(valid_event("auth-0001"));
    constexpr std::uint64_t capacity =
        contract::ContractProfile::maximum_encoded_batch_bytes;
    auto config = configuration(workspace, 1U, capacity);
    const auto outbox = workspace.path() / "outbox/collector-runtime-01";
    std::filesystem::create_directories(outbox);
    std::ofstream filler{outbox / "capacity.bin", std::ios::binary};
    filler.seekp(static_cast<std::streamoff>(capacity - 1U));
    filler.put('\0');
    filler.close();

    FixedClock clock;
    FixedResources resources;
    DeterministicIdentifiers identifiers{50U};
    CollectorRuntime runtime{config, clock, identifiers, resources};
    const auto started = CollectorRuntime::MonotonicTime{};
    runtime.start(started);
    runtime.poll_once(started);
    runtime.poll_once(started + std::chrono::seconds{30});

    EXPECT_TRUE(runtime.snapshot().pending_publication);
    EXPECT_FALSE(std::filesystem::exists(config.output.checkpoint_file));
    EXPECT_TRUE(runtime.operational_snapshot().active_degradation);
    const auto heartbeat = contract::parse_heartbeat(durability::read_file_bounded(
        runtime.heartbeat_path(), 1024U * 1024U));
    EXPECT_EQ(heartbeat.status, contract::HeartbeatStatus::degraded);
}

} // namespace
} // namespace trivikrama::collector::runtime
