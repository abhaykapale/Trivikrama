#pragma once

#include "trivikrama/collector/contract/contract_profile.hpp"

#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace trivikrama::collector::contract {

using Json = nlohmann::json;

struct Integrity final {
    std::string algorithm{ContractProfile::signature_algorithm};
    std::string key_id;
    std::optional<std::string> value;

    bool operator==(const Integrity&) const = default;
};

struct EventSource final {
    std::string source_id;
    std::string adapter_type;
    std::string upstream_sender_id;
    std::string original_endpoint_id;
    std::string upstream_event_id;
    Json position{Json::object()};

    bool operator==(const EventSource&) const = default;
};

struct ContractEvent final {
    std::string event_id;
    EventSource source;
    std::string event_time;
    std::string received_time;
    std::string content_type;
    std::string raw_payload;
    Json ocsf{Json::object()};
    Json mapping = nullptr;

    bool operator==(const ContractEvent&) const = default;
};

struct EventBatch final {
    std::string contract_version{ContractProfile::contract_version};
    std::string message_type{ContractProfile::event_batch_message_type};
    std::string batch_id;
    std::string collector_id;
    std::string created_at;
    std::string ocsf_schema_version{ContractProfile::ocsf_schema_version};
    std::vector<ContractEvent> events;
    Integrity integrity;

    [[nodiscard]] std::size_t event_count() const noexcept { return events.size(); }

    bool operator==(const EventBatch&) const = default;
};

enum class HeartbeatStatus {
    online,
    degraded,
    shutting_down,
};

struct HeartbeatMetrics final {
    std::uint64_t events_received{};
    std::uint64_t events_published{};
    std::uint64_t events_rejected{};
    std::uint64_t events_lost_best_effort{};
    std::uint64_t queue_events{};
    std::uint64_t queue_bytes{};
    std::uint64_t outbox_batches{};
    std::uint64_t outbox_bytes{};
    std::optional<std::string> last_batch_id;
    double cpu_percent{};
    std::uint64_t memory_bytes{};
    std::uint64_t disk_available_bytes{};

    bool operator==(const HeartbeatMetrics&) const = default;
};

struct Heartbeat final {
    std::string contract_version{ContractProfile::contract_version};
    std::string message_type{ContractProfile::heartbeat_message_type};
    std::string collector_id;
    std::uint64_t sequence{};
    std::string timestamp;
    std::string started_at;
    std::string collector_version;
    std::string configuration_version;
    HeartbeatStatus status{HeartbeatStatus::online};
    HeartbeatMetrics metrics;
    Integrity integrity;

    bool operator==(const Heartbeat&) const = default;
};

enum class RejectionStage {
    input_validation,
};

enum class RejectionCode {
    invalid_json,
    invalid_utf8,
    missing_required_field,
    invalid_field_type,
    invalid_timestamp,
    invalid_ip_address,
    unsupported_event_type,
    record_too_large,
    mapping_failed,
    ocsf_validation_failed,
};

struct RejectedSource final {
    std::string source_id;
    std::string adapter_type;
    std::string file_identity;
    std::uint64_t record_start_offset{};
    std::uint64_t record_end_offset{};

    bool operator==(const RejectedSource&) const = default;
};

struct Rejection final {
    RejectionStage stage{RejectionStage::input_validation};
    RejectionCode code{RejectionCode::invalid_json};
    std::string message;

    bool operator==(const Rejection&) const = default;
};

struct RejectedPayload final {
    std::string content_type;
    std::uint64_t byte_length{};
    std::string sha256;
    std::string capture_encoding{"base64"};
    std::string capture;
    bool capture_truncated{};

    bool operator==(const RejectedPayload&) const = default;
};

struct RejectedEvent final {
    std::string contract_version{ContractProfile::contract_version};
    std::string message_type{ContractProfile::rejected_event_message_type};
    std::string rejection_id;
    std::string collector_id;
    std::string rejected_at;
    RejectedSource source;
    Rejection rejection;
    RejectedPayload payload;
    Integrity integrity;

    bool operator==(const RejectedEvent&) const = default;
};

} // namespace trivikrama::collector::contract
