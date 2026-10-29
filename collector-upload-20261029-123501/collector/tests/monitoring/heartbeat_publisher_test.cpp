#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"
#include "trivikrama/collector/monitoring/heartbeat_publisher.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <optional>
#include <string>

namespace trivikrama::collector::monitoring {
namespace {

class TemporaryDirectory final {
  public:
    TemporaryDirectory()
        : path_{std::filesystem::temp_directory_path() /
                ("trivikrama-heartbeat-" +
                 std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()))} {
        std::filesystem::create_directories(path_ / "handoff");
        std::filesystem::create_directories(path_ / "state");
    }
    ~TemporaryDirectory() { std::filesystem::remove_all(path_); }
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::filesystem::path path_;
};

class FakeResourceProbe final : public IResourceProbe {
  public:
    [[nodiscard]] ResourceMetrics sample() override { return value; }
    ResourceMetrics value{10.0, 64U * 1024U * 1024U, 1024U * 1024U * 1024U, true};
};

[[nodiscard]] config::SecretValue test_secret() {
    return config::SecretValue{std::string(64U, 'A')};
}

[[nodiscard]] HeartbeatPublisherOptions options(const TemporaryDirectory& temporary) {
    return HeartbeatPublisherOptions{
        "collector-01",
        "0.8.0",
        "test-config-v1",
        "2026-10-03T18:00:00Z",
        temporary.path() / "handoff",
        temporary.path() / "state",
        std::chrono::seconds{30},
        10U * 1024U * 1024U,
        10U,
        80U,
        8U * 1024U * 1024U,
    };
}

[[nodiscard]] contract::Heartbeat read_heartbeat(const std::filesystem::path& path) {
    return contract::parse_heartbeat(durability::read_file_bounded(path, 1024U * 1024U));
}

TEST(HeartbeatPublisher, PublishesSignedIdentityScopedHeartbeatOnThirtySecondSchedule) {
    const TemporaryDirectory temporary;
    const auto secret = test_secret();
    const security::ContractSigner signer{"key-01", secret};
    OperationalMetrics metrics;
    metrics.record_received(5U);
    FakeResourceProbe resources;
    HeartbeatPublisher publisher{options(temporary), signer, metrics, resources};
    const auto started = HeartbeatPublisher::MonotonicTime{};

    EXPECT_TRUE(publisher.due(started));
    const auto first = publisher.publish_if_due(started, "2026-10-03T18:00:01Z");
    ASSERT_TRUE(first.has_value());
    EXPECT_EQ(first->heartbeat.sequence, 0U);
    EXPECT_EQ(first->heartbeat.status, contract::HeartbeatStatus::online);
    EXPECT_TRUE(signer.verify(first->heartbeat));
    EXPECT_EQ(first->published_path,
              temporary.path() / "handoff/incoming/collector-01/heartbeat.json");
    EXPECT_EQ(read_heartbeat(first->published_path), first->heartbeat);
    EXPECT_FALSE(std::filesystem::exists(first->published_path.string() + ".tmp"));

    EXPECT_FALSE(publisher.publish_if_due(started + std::chrono::seconds{29},
                                          "2026-10-03T18:00:30Z")
                     .has_value());
    const auto second = publisher.publish_if_due(started + std::chrono::seconds{30},
                                                 "2026-10-03T18:00:31Z");
    ASSERT_TRUE(second.has_value());
    EXPECT_EQ(second->heartbeat.sequence, 1U);
}

TEST(HeartbeatPublisher, RecoversSequenceAcrossProcessRestart) {
    const TemporaryDirectory temporary;
    const auto secret = test_secret();
    const security::ContractSigner signer{"key-01", secret};
    OperationalMetrics metrics;
    FakeResourceProbe resources;
    {
        HeartbeatPublisher first{options(temporary), signer, metrics, resources};
        static_cast<void>(first.publish("2026-10-03T18:00:01Z"));
    }

    HeartbeatPublisher restarted{options(temporary), signer, metrics, resources};
    const auto receipt = restarted.publish("2026-10-03T18:00:02Z");
    EXPECT_EQ(receipt.heartbeat.sequence, 1U);
    EXPECT_FALSE(std::filesystem::exists(
        restarted.sequence_state_path().string() + ".tmp"));
}

TEST(HeartbeatPublisher, DerivesDegradedAndShuttingDownStates) {
    const TemporaryDirectory temporary;
    const auto secret = test_secret();
    const security::ContractSigner signer{"key-01", secret};
    OperationalMetrics metrics;
    FakeResourceProbe resources;
    HeartbeatPublisher publisher{options(temporary), signer, metrics, resources};

    metrics.update_outbox(durability::OutboxUsage{8U * 1024U * 1024U, 1U});
    const auto degraded = publisher.publish("2026-10-03T18:00:01Z");
    EXPECT_EQ(degraded.heartbeat.status, contract::HeartbeatStatus::degraded);

    metrics.update_outbox(durability::OutboxUsage{0U, 0U});
    const auto online = publisher.publish("2026-10-03T18:00:02Z");
    EXPECT_EQ(online.heartbeat.status, contract::HeartbeatStatus::online);

    const auto shutdown = publisher.publish_shutdown("2026-10-03T18:00:03Z");
    EXPECT_EQ(shutdown.heartbeat.status, contract::HeartbeatStatus::shutting_down);
    EXPECT_TRUE(signer.verify(shutdown.heartbeat));
}

TEST(HeartbeatPublisher, ReportsThePreviousPublicationFailureAsDegraded) {
    const TemporaryDirectory temporary;
    const auto secret = test_secret();
    const security::ContractSigner signer{"key-01", secret};
    OperationalMetrics metrics;
    FakeResourceProbe resources;
    HeartbeatPublisher publisher{options(temporary), signer, metrics, resources};
    std::filesystem::create_directories(publisher.heartbeat_path());

    EXPECT_THROW(static_cast<void>(publisher.publish("2026-10-03T18:00:01Z")),
                 durability::DurableFileError);
    std::filesystem::remove_all(publisher.heartbeat_path());

    const auto recovered = publisher.publish("2026-10-03T18:00:02Z");
    EXPECT_EQ(recovered.heartbeat.sequence, 1U);
    EXPECT_EQ(recovered.heartbeat.status, contract::HeartbeatStatus::degraded);
}

TEST(HeartbeatPublisher, RejectsAHeartbeatIntervalOutsideTheFrozenContract) {
    const TemporaryDirectory temporary;
    const auto secret = test_secret();
    const security::ContractSigner signer{"key-01", secret};
    OperationalMetrics metrics;
    FakeResourceProbe resources;
    auto invalid = options(temporary);
    invalid.interval = std::chrono::seconds{60};

    EXPECT_THROW(HeartbeatPublisher(invalid, signer, metrics, resources),
                 std::invalid_argument);
}

} // namespace
} // namespace trivikrama::collector::monitoring
