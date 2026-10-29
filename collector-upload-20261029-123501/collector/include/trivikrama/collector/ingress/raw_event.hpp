#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <cstdint>
#include <string>

namespace trivikrama::collector::ingress {

struct RawEvent final {
    std::string source_id;
    std::string adapter_type;
    std::string upstream_sender_id;
    std::string original_endpoint_id;
    std::string upstream_event_id;
    contract::Json position{contract::Json::object()};
    std::string event_time;
    std::string received_time;
    std::string content_type;
    std::string raw_payload;
    contract::Json decoded_payload{contract::Json::object()};
    contract::Json transport_security{contract::Json::object()};

    bool operator==(const RawEvent&) const = default;
};

struct InputRejection final {
    contract::RejectionCode code{contract::RejectionCode::invalid_json};
    std::string message;
    std::string source_id;
    std::string adapter_type;
    std::string file_identity;
    std::uint64_t record_start_offset{};
    std::uint64_t record_end_offset{};
    std::string content_type;
    std::uint64_t byte_length{};
    std::string capture;
    bool capture_truncated{};
    std::string payload_sha256{};

    bool operator==(const InputRejection&) const = default;
};

} // namespace trivikrama::collector::ingress
