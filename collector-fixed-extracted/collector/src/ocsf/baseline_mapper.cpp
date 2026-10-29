#include "trivikrama/collector/ocsf/baseline_mapper.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/security/payload_encoding.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <iomanip>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

#ifdef _WIN32
#define NOMINMAX
#include <WinSock2.h>
#include <WS2tcpip.h>
#else
#include <arpa/inet.h>
#endif

namespace trivikrama::collector::ocsf {
namespace {

using contract::ContractEvent;
using contract::Json;
using contract::RejectionCode;
using ingress::InputRejection;
using ingress::RawEvent;

constexpr std::size_t maximum_rejection_capture_bytes = 64U * 1024U;

[[nodiscard]] InputRejection reject(const RawEvent& event, const RejectionCode code,
                                    std::string message) {
    const auto capture_size =
        std::min(event.raw_payload.size(), maximum_rejection_capture_bytes);
    const auto& position = event.position;
    return InputRejection{
        code,
        std::move(message),
        event.source_id,
        event.adapter_type,
        position.value("file_identity", std::string{"unknown"}),
        position.value("record_start_offset", std::uint64_t{}),
        position.value("record_end_offset", std::uint64_t{}),
        event.content_type,
        static_cast<std::uint64_t>(event.raw_payload.size()),
        event.raw_payload.substr(0U, capture_size),
        event.raw_payload.size() > capture_size,
        security::sha256_hex(event.raw_payload)};
}

[[nodiscard]] std::optional<std::string> required_string(const Json& document,
                                                         const std::string_view key,
                                                         RejectionCode& code,
                                                         std::string& message) {
    const std::string name{key};
    if (!document.contains(name)) {
        code = RejectionCode::missing_required_field;
        message = "required mapping field is absent: " + name;
        return std::nullopt;
    }
    if (!document.at(name).is_string()) {
        code = RejectionCode::invalid_field_type;
        message = "mapping field must be a string: " + name;
        return std::nullopt;
    }
    auto value = document.at(name).get<std::string>();
    if (value.empty()) {
        code = RejectionCode::missing_required_field;
        message = "required mapping field must not be empty: " + name;
        return std::nullopt;
    }
    return value;
}

[[nodiscard]] bool valid_ip_address(const std::string& value) noexcept {
    std::array<unsigned char, 16U> storage{};
#ifdef _WIN32
    return ::InetPtonA(AF_INET, value.c_str(), storage.data()) == 1 ||
           ::InetPtonA(AF_INET6, value.c_str(), storage.data()) == 1;
#else
    return ::inet_pton(AF_INET, value.c_str(), storage.data()) == 1 ||
           ::inet_pton(AF_INET6, value.c_str(), storage.data()) == 1;
#endif
}

[[nodiscard]] std::optional<std::int64_t> rfc3339_milliseconds(const std::string& value) {
    static const std::regex pattern{
        R"(^([0-9]{4})-([0-9]{2})-([0-9]{2})T)"
        R"(([0-9]{2}):([0-9]{2}):([0-9]{2})(\.([0-9]+))?)"
        R"((Z|([+-])([0-9]{2}):([0-9]{2}))$)",
        std::regex::ECMAScript};
    std::smatch match;
    if (!std::regex_match(value, match, pattern)) {
        return std::nullopt;
    }
    try {
        const auto year = std::stoi(match[1].str());
        const auto month = static_cast<unsigned>(std::stoul(match[2].str()));
        const auto day = static_cast<unsigned>(std::stoul(match[3].str()));
        const auto hour = std::stoul(match[4].str());
        const auto minute = std::stoul(match[5].str());
        const auto second = std::stoul(match[6].str());
        const std::chrono::year_month_day calendar{
            std::chrono::year{year}, std::chrono::month{month}, std::chrono::day{day}};
        if (!calendar.ok() || hour > 23U || minute > 59U || second > 59U) {
            return std::nullopt;
        }

        std::int64_t fractional_milliseconds = 0;
        if (match[8].matched) {
            auto fraction = match[8].str();
            fraction.resize(3U, '0');
            fractional_milliseconds = std::stoll(fraction.substr(0U, 3U));
        }

        const auto local = std::chrono::sys_days{calendar} + std::chrono::hours{hour} +
                           std::chrono::minutes{minute} + std::chrono::seconds{second} +
                           std::chrono::milliseconds{fractional_milliseconds};
        auto utc = local;
        if (match[9].str() != "Z") {
            const auto offset = std::chrono::hours{std::stoll(match[11].str())} +
                                std::chrono::minutes{std::stoll(match[12].str())};
            utc += match[10].str() == "+" ? -offset : offset;
        }
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                   utc.time_since_epoch())
            .count();
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

[[nodiscard]] Json unmapped_fields(const Json& document) {
    static const std::set<std::string, std::less<>> mapped{
        "endpoint_id", "event_id", "event_type", "message", "source_ip", "timestamp",
        "username"};
    Json result = Json::object();
    for (const auto& [key, value] : document.items()) {
        if (!mapped.contains(key)) {
            result[key] = value;
        }
    }
    return result;
}

[[nodiscard]] std::string utc_timestamp(const std::int64_t milliseconds) {
    const auto instant = std::chrono::system_clock::time_point{
        std::chrono::milliseconds{milliseconds}};
    const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(instant);
    const auto time = std::chrono::system_clock::to_time_t(seconds);
    std::tm utc{};
#ifdef _WIN32
    if (::gmtime_s(&utc, &time) != 0) {
#else
    if (::gmtime_r(&time, &utc) == nullptr) {
#endif
        throw std::runtime_error{"cannot normalize event timestamp"};
    }
    const auto fraction = milliseconds -
                          std::chrono::duration_cast<std::chrono::milliseconds>(
                              seconds.time_since_epoch())
                              .count();
    std::ostringstream result;
    result << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S.") << std::setfill('0')
           << std::setw(3) << fraction << 'Z';
    return result.str();
}

} // namespace

MappingResult BaselineMapper::map(const RawEvent& event) const {
    if (!event.decoded_payload.is_object()) {
        return reject(event, RejectionCode::invalid_field_type,
                      "decoded input must be a JSON object");
    }

    RejectionCode code = RejectionCode::mapping_failed;
    std::string message;
    const auto event_type = required_string(event.decoded_payload, "event_type", code, message);
    if (!event_type) {
        return reject(event, code, std::move(message));
    }
    const auto username = required_string(event.decoded_payload, "username", code, message);
    if (!username) {
        return reject(event, code, std::move(message));
    }
    const auto source_ip = required_string(event.decoded_payload, "source_ip", code, message);
    if (!source_ip) {
        return reject(event, code, std::move(message));
    }
    if (*event_type != "login_success" && *event_type != "login_failed") {
        return reject(event, RejectionCode::unsupported_event_type,
                      "simulated mapper supports only login_success and login_failed");
    }
    if (!valid_ip_address(*source_ip)) {
        return reject(event, RejectionCode::invalid_ip_address,
                      "source_ip is not a valid IPv4 or IPv6 address");
    }
    const auto time = rfc3339_milliseconds(event.event_time);
    if (!time.has_value()) {
        return reject(event, RejectionCode::invalid_timestamp,
                      "timestamp must be a valid RFC 3339 instant");
    }

    const auto failed = *event_type == "login_failed";
    const std::string mapped_message =
        failed ? "Failed login for " + *username : "Successful login for " + *username;
    Json ocsf{{"activity_id", 1U},
              {"category_uid", 3U},
              {"class_uid", 3002U},
              {"dst_endpoint", Json{{"hostname", event.original_endpoint_id}}},
              {"message", std::move(mapped_message)},
              {"metadata",
               Json{{"product", Json{{"name", "Trivikrama Collector"},
                                      {"vendor_name", "Trivikrama"}}},
                    {"version", std::string{contract::ContractProfile::ocsf_schema_version}}}},
              {"severity_id", failed ? 3U : 1U},
              {"src_endpoint", Json{{"ip", *source_ip}}},
              {"status_id", failed ? 2U : 1U},
              {"time", *time},
              {"type_uid", 300201U},
              {"user", Json{{"name", *username}}}};
    auto unmapped = unmapped_fields(event.decoded_payload);
    ocsf["unmapped"] = std::move(unmapped);

    const auto& position = event.position;
    const auto identity_input = event.source_id + "\n" +
                                position.at("file_identity").get<std::string>() + "\n" +
                                std::to_string(position.at("record_start_offset").get<std::uint64_t>());

    return ContractEvent{"sha256:" + security::sha256_hex(identity_input),
                         contract::EventSource{event.source_id,
                                               event.adapter_type,
                                               event.upstream_sender_id,
                                               event.original_endpoint_id,
                                               event.upstream_event_id,
                                               event.position},
                         utc_timestamp(*time),
                         event.received_time,
                         event.content_type,
                         event.raw_payload,
                         std::move(ocsf),
                         Json{{"name", "trivikrama.simulated-auth"},
                              {"version", "1.0.0"}}};
}

} // namespace trivikrama::collector::ocsf
