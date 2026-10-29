#include "trivikrama/collector/contract/serialization.hpp"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <functional>
#include <iterator>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::contract {
namespace {

[[nodiscard]] std::string load_fixture_text(const std::string& filename) {
    const auto path = std::filesystem::path{COLLECTOR_CONTRACT_FIXTURE_DIR} / filename;
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        throw std::runtime_error{"Unable to open contract fixture: " + path.string()};
    }
    return {std::istreambuf_iterator<char>{input}, std::istreambuf_iterator<char>{}};
}

void expect_contract_error(const std::function<void()>& operation, const std::string_view code) {
    try {
        operation();
        FAIL() << "Expected ContractError with code " << code;
    } catch (const ContractError& error) {
        EXPECT_EQ(error.code(), code);
    }
}

[[nodiscard]] std::string test_signature() {
    return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
}

} // namespace

TEST(Serialization, ParsesAndRoundTripsSignedEventBatch) {
    auto batch = parse_event_batch(load_fixture_text("unsigned-batch.json"),
                                   SignatureRequirement::allow_unsigned);
    batch.integrity.value = test_signature();

    const auto encoded = serialize(batch);
    const auto decoded = parse_event_batch(encoded);

    EXPECT_EQ(decoded, batch);
    EXPECT_EQ(decoded.event_count(), 1U);
    EXPECT_EQ(decoded.events.at(0).source.original_endpoint_id, "simulated-host-01");
    EXPECT_EQ(decoded.events.at(0).source.upstream_event_id, "auth:000001");
}

TEST(Serialization, UnsignedDocumentOmitsOnlyIntegrityValue) {
    auto batch = parse_event_batch(load_fixture_text("unsigned-batch.json"),
                                   SignatureRequirement::allow_unsigned);
    batch.integrity.value = test_signature();

    const auto unsigned_document = to_json_document(batch, false);

    ASSERT_TRUE(unsigned_document.contains("integrity"));
    EXPECT_EQ(unsigned_document.at("integrity").at("algorithm"), "HMAC-SHA256");
    EXPECT_EQ(unsigned_document.at("integrity").at("key_id"), "collector-test-key-01");
    EXPECT_FALSE(unsigned_document.at("integrity").contains("value"));
}

TEST(Serialization, RequiresSignatureForNormalParsing) {
    expect_contract_error(
        [] { static_cast<void>(parse_event_batch(load_fixture_text("unsigned-batch.json"))); },
        "missing_required_field");
}

TEST(Serialization, PreservesRawPayloadExactly) {
    const auto batch = parse_event_batch(load_fixture_text("unsigned-batch.json"),
                                         SignatureRequirement::allow_unsigned);
    const auto original = batch.events.at(0).raw_payload;
    const auto round_trip = parse_event_batch(serialize(batch, false),
                                              SignatureRequirement::allow_unsigned);
    EXPECT_EQ(round_trip.events.at(0).raw_payload, original);
}

TEST(Serialization, RejectsDuplicateDecodedKeys) {
    expect_contract_error([] { static_cast<void>(parse_json_strict(R"({"a":1,"a":2})")); },
                          "invalid_json");
}

TEST(Serialization, RejectsUtf8Bom) {
    const std::string input{"\xEF\xBB\xBF{}", 5U};
    expect_contract_error([&input] { static_cast<void>(parse_json_strict(input)); }, "invalid_bom");
}

TEST(Serialization, RejectsUnsafeInteger) {
    expect_contract_error(
        [] { static_cast<void>(parse_json_strict(R"({"value":9007199254740992})")); },
        "invalid_json");
}

TEST(Serialization, RejectsUnknownEnvelopeField) {
    auto document = parse_json_strict(load_fixture_text("unsigned-batch.json"));
    document["unexpected"] = true;
    expect_contract_error(
        [&document] {
            static_cast<void>(
                parse_event_batch(document.dump(), SignatureRequirement::allow_unsigned));
        },
        "unknown_field");
}

TEST(Serialization, RejectsEventCountMismatch) {
    auto document = parse_json_strict(load_fixture_text("unsigned-batch.json"));
    document["event_count"] = 2;
    expect_contract_error(
        [&document] {
            static_cast<void>(
                parse_event_batch(document.dump(), SignatureRequirement::allow_unsigned));
        },
        "event_count_mismatch");
}

TEST(Serialization, RejectsInvalidBatchUuidVersion) {
    auto document = parse_json_strict(load_fixture_text("unsigned-batch.json"));
    document["batch_id"] = "123e4567-e89b-12d3-a456-426614174000";
    expect_contract_error(
        [&document] {
            static_cast<void>(
                parse_event_batch(document.dump(), SignatureRequirement::allow_unsigned));
        },
        "invalid_uuid");
}

TEST(Serialization, ParsesAndRoundTripsHeartbeat) {
    const auto heartbeat = parse_heartbeat(load_fixture_text("heartbeat.json"));
    const auto decoded = parse_heartbeat(serialize(heartbeat));

    EXPECT_EQ(decoded, heartbeat);
    EXPECT_EQ(decoded.status, HeartbeatStatus::online);
    EXPECT_EQ(decoded.metrics.events_received, 11U);
    ASSERT_TRUE(decoded.metrics.last_batch_id.has_value());
}

TEST(Serialization, OfflineIsBackendDerivedAndRejectedOnWire) {
    auto document = parse_json_strict(load_fixture_text("heartbeat.json"));
    document["status"] = "offline";
    expect_contract_error(
        [&document] { static_cast<void>(parse_heartbeat(document.dump())); }, "invalid_enum");
}

TEST(Serialization, RejectsHeartbeatCpuOutsidePercentageRange) {
    auto document = parse_json_strict(load_fixture_text("heartbeat.json"));
    document["metrics"]["cpu_percent"] = 100.1;
    expect_contract_error(
        [&document] { static_cast<void>(parse_heartbeat(document.dump())); },
        "invalid_numeric_value");
}

TEST(Serialization, RejectsUnsafeDomainCounterDuringSerialization) {
    auto heartbeat = parse_heartbeat(load_fixture_text("heartbeat.json"));
    heartbeat.metrics.events_received = std::numeric_limits<std::uint64_t>::max();
    expect_contract_error([&heartbeat] { static_cast<void>(serialize(heartbeat)); }, "unsafe_number");
}

TEST(Serialization, ParsesAndRoundTripsRejectedEvent) {
    const auto rejected = parse_rejected_event(load_fixture_text("rejected-event.json"));
    const auto decoded = parse_rejected_event(serialize(rejected));

    EXPECT_EQ(decoded, rejected);
    EXPECT_EQ(decoded.rejection.stage, RejectionStage::input_validation);
    EXPECT_EQ(decoded.rejection.code, RejectionCode::invalid_json);
}

TEST(Serialization, RejectsInconsistentCaptureLength) {
    auto document = parse_json_strict(load_fixture_text("rejected-event.json"));
    document["payload"]["byte_length"] = 4;
    expect_contract_error(
        [&document] { static_cast<void>(parse_rejected_event(document.dump())); },
        "invalid_capture_length");
}

TEST(Serialization, RejectsUnknownRejectionCode) {
    auto document = parse_json_strict(load_fixture_text("rejected-event.json"));
    document["rejection"]["code"] = "invented_code";
    expect_contract_error(
        [&document] { static_cast<void>(parse_rejected_event(document.dump())); }, "invalid_enum");
}

} // namespace trivikrama::collector::contract

