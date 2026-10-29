#include "trivikrama/collector/ocsf/baseline_mapper.hpp"

#include "trivikrama/collector/contract/serialization.hpp"

#include <gtest/gtest.h>

#include <string>
#include <variant>

namespace trivikrama::collector::ocsf {
namespace {

[[nodiscard]] ingress::RawEvent raw_event(const std::string& payload) {
    return ingress::RawEvent{
        "simulated_auth_input",
        "file",
        "simulator-01",
        "simulated-host-01",
        "auth:000001",
        contract::Json{{"file_identity", "1:2"},
                       {"record_start_offset", 0U},
                       {"record_end_offset", payload.size() + 1U}},
        "2026-08-29T12:44:40Z",
        "2026-08-29T12:44:41Z",
        "application/json",
        payload,
        contract::parse_json_strict(payload),
        contract::Json{{"boundary", "filesystem_acl"}}};
}

[[nodiscard]] std::string failed_login(const std::string& extra = {}) {
    return "{\"endpoint_id\":\"simulated-host-01\",\"event_id\":\"auth:000001\","
           "\"event_type\":\"login_failed\",\"source_ip\":\"192.0.2.10\","
           "\"timestamp\":\"2026-08-29T12:44:40Z\",\"username\":\"test-user\"" +
           extra + "}";
}

TEST(BaselineMapperTest, MapsFailedAuthenticationAndPreservesIdentityAndRawPayload) {
    const auto input = raw_event(failed_login());
    const BaselineMapper mapper;

    const auto result = mapper.map(input);

    ASSERT_TRUE(std::holds_alternative<contract::ContractEvent>(result));
    const auto& event = std::get<contract::ContractEvent>(result);
    EXPECT_TRUE(event.event_id.starts_with("sha256:"));
    EXPECT_EQ(event.source.original_endpoint_id, "simulated-host-01");
    EXPECT_EQ(event.source.upstream_event_id, "auth:000001");
    EXPECT_EQ(event.raw_payload, input.raw_payload);
    EXPECT_EQ(event.ocsf.at("category_uid"), 3U);
    EXPECT_EQ(event.ocsf.at("class_uid"), 3002U);
    EXPECT_EQ(event.ocsf.at("activity_id"), 1U);
    EXPECT_EQ(event.ocsf.at("type_uid"), 300201U);
    EXPECT_EQ(event.ocsf.at("status_id"), 2U);
    EXPECT_EQ(event.ocsf.at("severity_id"), 3U);
    EXPECT_EQ(event.ocsf.at("time"), 1788007480000LL);
    EXPECT_EQ(event.ocsf.at("dst_endpoint").at("hostname"), "simulated-host-01");
    EXPECT_EQ(event.ocsf.at("user").at("name"), "test-user");
}

TEST(BaselineMapperTest, MapsSuccessfulAuthentication) {
    auto input = raw_event(failed_login());
    input.decoded_payload["event_type"] = "login_success";
    const BaselineMapper mapper;

    const auto event = std::get<contract::ContractEvent>(mapper.map(input));

    EXPECT_EQ(event.ocsf.at("activity_id"), 1U);
    EXPECT_EQ(event.ocsf.at("type_uid"), 300201U);
    EXPECT_EQ(event.ocsf.at("status_id"), 1U);
    EXPECT_EQ(event.ocsf.at("severity_id"), 1U);
}

TEST(BaselineMapperTest, PreservesUnknownSourceFieldsUnderUnmapped) {
    const auto input = raw_event(failed_login(",\"reason\":\"invalid_password\""));
    const BaselineMapper mapper;

    const auto event = std::get<contract::ContractEvent>(mapper.map(input));

    ASSERT_TRUE(event.ocsf.contains("unmapped"));
    EXPECT_EQ(event.ocsf.at("unmapped").at("reason"), "invalid_password");
    EXPECT_FALSE(event.ocsf.at("unmapped").contains("username"));
}

TEST(BaselineMapperTest, ConvertsTimestampOffsetsToUtcEpochMilliseconds) {
    auto input = raw_event(failed_login());
    input.event_time = "2026-08-29T14:44:40+02:00";
    const BaselineMapper mapper;

    const auto event = std::get<contract::ContractEvent>(mapper.map(input));

    EXPECT_EQ(event.ocsf.at("time"), 1788007480000LL);
}

TEST(BaselineMapperTest, RejectsUnsupportedEventTypeInvalidTimestampAndIp) {
    const BaselineMapper mapper;

    auto unsupported = raw_event(failed_login());
    unsupported.decoded_payload["event_type"] = "process_started";
    EXPECT_EQ(std::get<ingress::InputRejection>(mapper.map(unsupported)).code,
              contract::RejectionCode::unsupported_event_type);

    auto timestamp = raw_event(failed_login());
    timestamp.event_time = "2026-02-30T12:00:00Z";
    EXPECT_EQ(std::get<ingress::InputRejection>(mapper.map(timestamp)).code,
              contract::RejectionCode::invalid_timestamp);

    auto address = raw_event(failed_login());
    address.decoded_payload["source_ip"] = "999.1.2.3";
    EXPECT_EQ(std::get<ingress::InputRejection>(mapper.map(address)).code,
              contract::RejectionCode::invalid_ip_address);
}

TEST(BaselineMapperTest, RejectsMissingOrMistypedMappingFields) {
    const BaselineMapper mapper;

    auto missing = raw_event(failed_login());
    missing.decoded_payload.erase("username");
    EXPECT_EQ(std::get<ingress::InputRejection>(mapper.map(missing)).code,
              contract::RejectionCode::missing_required_field);

    auto mistyped = raw_event(failed_login());
    mistyped.decoded_payload["source_ip"] = 123;
    EXPECT_EQ(std::get<ingress::InputRejection>(mapper.map(mistyped)).code,
              contract::RejectionCode::invalid_field_type);
}

TEST(BaselineMapperTest, ProducesAnEventCompatibleWithTheFrozenBatchContract) {
    const BaselineMapper mapper;
    auto event = std::get<contract::ContractEvent>(mapper.map(raw_event(failed_login())));
    contract::EventBatch batch;
    batch.batch_id = "123e4567-e89b-42d3-a456-426614174000";
    batch.collector_id = "collector-test-01";
    batch.created_at = "2026-08-29T12:44:43Z";
    batch.events.push_back(std::move(event));
    batch.integrity.key_id = "collector-test-key-01";

    const auto encoded = contract::serialize(batch, false);
    const auto decoded = contract::parse_event_batch(
        encoded, contract::SignatureRequirement::allow_unsigned);

    ASSERT_EQ(decoded.events.size(), 1U);
    EXPECT_TRUE(decoded.events.front().event_id.starts_with("sha256:"));
}

} // namespace
} // namespace trivikrama::collector::ocsf
