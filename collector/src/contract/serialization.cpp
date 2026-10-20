#include "trivikrama/collector/contract/serialization.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <optional>
#include <regex>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

namespace trivikrama::collector::contract {
namespace {

constexpr std::uint64_t maximum_safe_json_integer = 9'007'199'254'740'991ULL;
constexpr std::size_t maximum_json_nesting = 128U;
constexpr std::size_t maximum_rejected_capture_bytes = 64U * 1024U;

[[noreturn]] void fail(std::string code, std::string path, std::string message) {
    throw ContractError{std::move(code), std::move(path), std::move(message)};
}

class JsonSafetyScanner final : public nlohmann::json_sax<Json> {
  public:
    bool null() override { return true; }
    bool boolean(bool /*unused*/) override { return true; }

    bool number_integer(const number_integer_t value) override {
        if (value < -static_cast<number_integer_t>(maximum_safe_json_integer) ||
            value > static_cast<number_integer_t>(maximum_safe_json_integer)) {
            error_ = "integer exceeds the IEEE-754 safe-integer range";
            return false;
        }
        return true;
    }

    bool number_unsigned(const number_unsigned_t value) override {
        if (value > maximum_safe_json_integer) {
            error_ = "integer exceeds the IEEE-754 safe-integer range";
            return false;
        }
        return true;
    }

    bool number_float(const number_float_t value, const string_t& /*unused*/) override {
        if (!std::isfinite(value) || std::abs(value) > static_cast<double>(maximum_safe_json_integer)) {
            error_ = "number is non-finite or exceeds the safe numeric range";
            return false;
        }
        return true;
    }

    bool string(string_t& /*unused*/) override { return true; }
    bool binary(binary_t& /*unused*/) override { return true; }

    bool start_object(std::size_t /*unused*/) override { return start_container(true); }

    bool key(string_t& value) override {
        if (containers_.empty() || !containers_.back().has_value()) {
            error_ = "object key occurred outside an object";
            return false;
        }
        if (!containers_.back()->insert(value).second) {
            error_ = "duplicate decoded object key: " + value;
            return false;
        }
        return true;
    }

    bool end_object() override { return end_container(); }
    bool start_array(std::size_t /*unused*/) override { return start_container(false); }
    bool end_array() override { return end_container(); }

    bool parse_error(std::size_t /*position*/, const std::string& /*last_token*/,
                     const nlohmann::detail::exception& exception) override {
        error_ = exception.what();
        return false;
    }

    [[nodiscard]] const std::string& error() const noexcept { return error_; }

  private:
    using KeySet = std::unordered_set<std::string>;

    bool start_container(const bool object) {
        if (containers_.size() >= maximum_json_nesting) {
            error_ = "maximum JSON nesting depth exceeded";
            return false;
        }
        if (object) {
            containers_.emplace_back(KeySet{});
        } else {
            containers_.emplace_back(std::nullopt);
        }
        return true;
    }

    bool end_container() {
        if (containers_.empty()) {
            error_ = "unexpected container end";
            return false;
        }
        containers_.pop_back();
        return true;
    }

    std::vector<std::optional<KeySet>> containers_;
    std::string error_;
};

void require_object(const Json& value, const std::string_view path) {
    if (!value.is_object()) {
        fail("invalid_field_type", std::string{path}, "expected a JSON object");
    }
}

void require_exact_keys(const Json& value, const std::string_view path,
                        const std::initializer_list<std::string_view> required,
                        const std::initializer_list<std::string_view> optional = {}) {
    require_object(value, path);

    for (const auto key : required) {
        if (!value.contains(std::string{key})) {
            fail("missing_required_field", std::string{path} + "." + std::string{key},
                 "required field is absent");
        }
    }

    for (const auto& [key, unused] : value.items()) {
        static_cast<void>(unused);
        const auto accepted = [key](const std::string_view candidate) { return key == candidate; };
        if (std::none_of(required.begin(), required.end(), accepted) &&
            std::none_of(optional.begin(), optional.end(), accepted)) {
            fail("unknown_field", std::string{path} + "." + key,
                 "field is not part of contract version 1.0.0");
        }
    }
}

void validate_json_tree(const Json& value, const std::string& path, const std::size_t depth = 0U) {
    if (depth > maximum_json_nesting) {
        fail("maximum_nesting_exceeded", path, "maximum JSON nesting depth is 128");
    }
    if (value.is_number_unsigned()) {
        if (value.get<std::uint64_t>() > maximum_safe_json_integer) {
            fail("unsafe_number", path, "integer exceeds the safe JSON range");
        }
        return;
    }
    if (value.is_number_integer()) {
        const auto number = value.get<std::int64_t>();
        if (number < -static_cast<std::int64_t>(maximum_safe_json_integer) ||
            number > static_cast<std::int64_t>(maximum_safe_json_integer)) {
            fail("unsafe_number", path, "integer exceeds the safe JSON range");
        }
        return;
    }
    if (value.is_number_float()) {
        const auto number = value.get<double>();
        if (!std::isfinite(number) ||
            std::abs(number) > static_cast<double>(maximum_safe_json_integer)) {
            fail("unsafe_number", path, "number is non-finite or exceeds the safe range");
        }
        return;
    }
    if (value.is_object()) {
        for (const auto& [key, child] : value.items()) {
            validate_json_tree(child, path + "." + key, depth + 1U);
        }
        return;
    }
    if (value.is_array()) {
        for (std::size_t index = 0; index < value.size(); ++index) {
            validate_json_tree(value.at(index), path + "[" + std::to_string(index) + "]",
                               depth + 1U);
        }
        return;
    }
    if (value.is_binary() || value.is_discarded()) {
        fail("invalid_json_type", path, "binary and discarded values are not JSON contract types");
    }
}

[[nodiscard]] std::string dump_strict(const Json& document) {
    validate_json_tree(document, "$");
    try {
        return document.dump(-1, ' ', false, Json::error_handler_t::strict);
    } catch (const Json::exception& exception) {
        fail("invalid_utf8", "$", exception.what());
    }
}

[[nodiscard]] std::string require_string(const Json& object, const std::string_view key,
                                         const std::string_view path) {
    const auto& value = object.at(std::string{key});
    if (!value.is_string()) {
        fail("invalid_field_type", std::string{path} + "." + std::string{key},
             "expected a string");
    }
    return value.get<std::string>();
}

[[nodiscard]] std::uint64_t require_safe_unsigned(const Json& object, const std::string_view key,
                                                  const std::string_view path) {
    const auto& value = object.at(std::string{key});
    if (!value.is_number_unsigned() && !value.is_number_integer()) {
        fail("invalid_field_type", std::string{path} + "." + std::string{key},
             "expected a nonnegative integer");
    }
    if (!value.is_number_unsigned() && value.get<std::int64_t>() < 0) {
        fail("invalid_numeric_value", std::string{path} + "." + std::string{key},
             "integer must be nonnegative");
    }
    const auto result = value.get<std::uint64_t>();
    if (result > maximum_safe_json_integer) {
        fail("unsafe_number", std::string{path} + "." + std::string{key},
             "integer exceeds the safe JSON range");
    }
    return result;
}

[[nodiscard]] double require_number(const Json& object, const std::string_view key,
                                    const std::string_view path) {
    const auto& value = object.at(std::string{key});
    if (!value.is_number()) {
        fail("invalid_field_type", std::string{path} + "." + std::string{key},
             "expected a number");
    }
    const auto result = value.get<double>();
    if (!std::isfinite(result)) {
        fail("invalid_numeric_value", std::string{path} + "." + std::string{key},
             "number must be finite");
    }
    return result;
}

[[nodiscard]] bool is_uuid_v4(const std::string_view value) noexcept {
    if (value.size() != 36U || value[8] != '-' || value[13] != '-' || value[18] != '-' ||
        value[23] != '-' || value[14] != '4') {
        return false;
    }
    const auto variant = value[19];
    if (variant != '8' && variant != '9' && variant != 'a' && variant != 'b' &&
        variant != 'A' && variant != 'B') {
        return false;
    }
    for (std::size_t index = 0; index < value.size(); ++index) {
        if (index == 8U || index == 13U || index == 18U || index == 23U) {
            continue;
        }
        const auto character = value[index];
        const auto hexadecimal = (character >= '0' && character <= '9') ||
                                 (character >= 'a' && character <= 'f') ||
                                 (character >= 'A' && character <= 'F');
        if (!hexadecimal) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool is_rfc3339(const std::string& value) {
    static const std::regex pattern{
        R"(^([0-9]{4})-([0-9]{2})-([0-9]{2})T)"
        R"(([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$)",
        std::regex::ECMAScript};
    std::smatch match;
    if (!std::regex_match(value, match, pattern)) {
        return false;
    }

    const auto year_value = std::stoi(match[1].str());
    const auto month_value = static_cast<unsigned>(std::stoul(match[2].str()));
    const auto day_value = static_cast<unsigned>(std::stoul(match[3].str()));
    const auto hour = std::stoul(match[4].str());
    const auto minute = std::stoul(match[5].str());
    const auto second = std::stoul(match[6].str());
    const std::chrono::year_month_day date{std::chrono::year{year_value},
                                           std::chrono::month{month_value},
                                           std::chrono::day{day_value}};
    if (!date.ok() || hour > 23U || minute > 59U || second > 60U) {
        return false;
    }

    const auto zone = match[8].str();
    if (zone != "Z") {
        const auto offset_hour = std::stoul(zone.substr(1U, 2U));
        const auto offset_minute = std::stoul(zone.substr(4U, 2U));
        if (offset_hour > 23U || offset_minute > 59U) {
            return false;
        }
    }
    return true;
}

[[nodiscard]] bool matches_identifier(const std::string_view value, const bool lowercase_only) {
    if (value.empty() || value.size() > 64U) {
        return false;
    }
    return std::all_of(value.begin(), value.end(), [lowercase_only](const char character) {
        const auto lower = character >= 'a' && character <= 'z';
        const auto upper = character >= 'A' && character <= 'Z';
        const auto digit = character >= '0' && character <= '9';
        return lower || (!lowercase_only && upper) || digit || character == '.' || character == '_' ||
               character == '-';
    });
}

[[nodiscard]] bool is_base64url_signature(const std::string_view value) {
    return value.size() == ContractProfile::encoded_signature_length &&
           std::all_of(value.begin(), value.end(), [](const char character) {
               return (character >= 'A' && character <= 'Z') ||
                      (character >= 'a' && character <= 'z') ||
                      (character >= '0' && character <= '9') || character == '_' ||
                      character == '-';
           });
}

[[nodiscard]] bool is_lower_hex(const std::string_view value, const std::size_t length) {
    return value.size() == length &&
           std::all_of(value.begin(), value.end(), [](const char character) {
               return (character >= '0' && character <= '9') ||
                      (character >= 'a' && character <= 'f');
           });
}

[[nodiscard]] std::optional<std::size_t> decoded_base64_size(const std::string_view value) {
    if (value.empty()) {
        return 0U;
    }
    if (value.size() % 4U != 0U) {
        return std::nullopt;
    }
    std::size_t padding = 0U;
    if (value.ends_with("==")) {
        padding = 2U;
    } else if (value.ends_with('=')) {
        padding = 1U;
    }
    for (std::size_t index = 0; index < value.size() - padding; ++index) {
        const auto character = value[index];
        const auto valid = (character >= 'A' && character <= 'Z') ||
                           (character >= 'a' && character <= 'z') ||
                           (character >= '0' && character <= '9') || character == '+' ||
                           character == '/';
        if (!valid) {
            return std::nullopt;
        }
    }
    if (std::any_of(value.end() - static_cast<std::ptrdiff_t>(padding), value.end(),
                    [](const char character) { return character != '='; })) {
        return std::nullopt;
    }
    return (value.size() / 4U) * 3U - padding;
}

void validate_collector_id(const std::string& value, const std::string_view path) {
    if (!matches_identifier(value, true)) {
        fail("invalid_collector_id", std::string{path},
             "must be 1-64 lowercase characters from [a-z0-9._-]");
    }
}

void validate_timestamp(const std::string& value, const std::string_view path) {
    if (!is_rfc3339(value)) {
        fail("invalid_timestamp", std::string{path}, "must be a valid RFC 3339 timestamp");
    }
}

void validate_uuid(const std::string& value, const std::string_view path) {
    if (!is_uuid_v4(value)) {
        fail("invalid_uuid", std::string{path}, "must be a UUIDv4 string");
    }
}

void validate_nonempty(const std::string& value, const std::string_view path) {
    if (value.empty()) {
        fail("invalid_string", std::string{path}, "must not be empty");
    }
}

void validate_integrity(const Integrity& integrity, const SignatureRequirement requirement,
                        const std::string_view path) {
    if (integrity.algorithm != ContractProfile::signature_algorithm) {
        fail("unsupported_algorithm", std::string{path} + ".algorithm",
             "algorithm must be HMAC-SHA256");
    }
    if (!matches_identifier(integrity.key_id, false)) {
        fail("invalid_key_id", std::string{path} + ".key_id",
             "must be 1-64 characters from [A-Za-z0-9._-]");
    }
    if (requirement == SignatureRequirement::required && !integrity.value.has_value()) {
        fail("missing_required_field", std::string{path} + ".value",
             "signed documents require integrity.value");
    }
    if (integrity.value.has_value() && !is_base64url_signature(*integrity.value)) {
        fail("invalid_signature", std::string{path} + ".value",
             "must be exactly 43 unpadded base64url characters");
    }
}

[[nodiscard]] Integrity parse_integrity(const Json& value, const SignatureRequirement requirement,
                                        const std::string_view path) {
    require_exact_keys(value, path, {"algorithm", "key_id"}, {"value"});
    Integrity integrity{require_string(value, "algorithm", path),
                        require_string(value, "key_id", path), std::nullopt};
    if (value.contains("value")) {
        integrity.value = require_string(value, "value", path);
    }
    validate_integrity(integrity, requirement, path);
    return integrity;
}

[[nodiscard]] Json integrity_to_json(const Integrity& integrity, const bool include_signature) {
    Json result{{"algorithm", integrity.algorithm}, {"key_id", integrity.key_id}};
    if (include_signature && integrity.value.has_value()) {
        result["value"] = *integrity.value;
    }
    return result;
}

void validate_event_source(const EventSource& source, const std::string_view path) {
    validate_nonempty(source.source_id, std::string{path} + ".source_id");
    validate_nonempty(source.adapter_type, std::string{path} + ".adapter_type");
    validate_nonempty(source.upstream_sender_id, std::string{path} + ".upstream_sender_id");
    validate_nonempty(source.original_endpoint_id, std::string{path} + ".original_endpoint_id");
    validate_nonempty(source.upstream_event_id, std::string{path} + ".upstream_event_id");
    if (!source.position.is_object() || source.position.empty()) {
        fail("invalid_source_position", std::string{path} + ".position",
             "must be a nonempty transport-specific object");
    }
    validate_json_tree(source.position, std::string{path} + ".position");
}

[[nodiscard]] EventSource parse_event_source(const Json& value, const std::string_view path) {
    require_exact_keys(value, path,
                       {"source_id", "adapter_type", "upstream_sender_id",
                        "original_endpoint_id", "upstream_event_id", "position"});
    EventSource source{require_string(value, "source_id", path),
                       require_string(value, "adapter_type", path),
                       require_string(value, "upstream_sender_id", path),
                       require_string(value, "original_endpoint_id", path),
                       require_string(value, "upstream_event_id", path), value.at("position")};
    validate_event_source(source, path);
    return source;
}

[[nodiscard]] Json event_source_to_json(const EventSource& source) {
    return Json{{"source_id", source.source_id},
                {"adapter_type", source.adapter_type},
                {"upstream_sender_id", source.upstream_sender_id},
                {"original_endpoint_id", source.original_endpoint_id},
                {"upstream_event_id", source.upstream_event_id},
                {"position", source.position}};
}

void validate_event(const ContractEvent& event, const std::string_view path) {
    validate_nonempty(event.event_id, std::string{path} + ".event_id");
    validate_event_source(event.source, std::string{path} + ".source");
    validate_timestamp(event.event_time, std::string{path} + ".event_time");
    validate_timestamp(event.received_time, std::string{path} + ".received_time");
    validate_nonempty(event.content_type, std::string{path} + ".content_type");
    if (event.raw_payload.size() > ContractProfile::maximum_encoded_event_bytes) {
        fail("record_too_large", std::string{path} + ".raw_payload",
             "raw payload exceeds the 512 KiB contract limit");
    }
    if (!event.ocsf.is_object()) {
        fail("invalid_field_type", std::string{path} + ".ocsf", "must be a JSON object");
    }
    validate_json_tree(event.ocsf, std::string{path} + ".ocsf");
    if (!event.mapping.is_null() && !event.mapping.is_object()) {
        fail("invalid_field_type", std::string{path} + ".mapping", "must be a JSON object");
    }
    validate_json_tree(event.mapping, std::string{path} + ".mapping");
}

[[nodiscard]] ContractEvent parse_event(const Json& value, const std::string_view path) {
    require_exact_keys(value, path,
                       {"event_id", "source", "event_time", "received_time", "content_type",
                        "raw_payload", "ocsf"}, {"mapping"});
    ContractEvent event{require_string(value, "event_id", path),
                        parse_event_source(value.at("source"), std::string{path} + ".source"),
                        require_string(value, "event_time", path),
                        require_string(value, "received_time", path),
                        require_string(value, "content_type", path),
                        require_string(value, "raw_payload", path), value.at("ocsf"),
                        value.contains("mapping") ? value.at("mapping") : Json(nullptr)};
    validate_event(event, path);
    return event;
}

[[nodiscard]] Json event_to_json(const ContractEvent& event) {
    Json result{{"event_id", event.event_id},
                {"source", event_source_to_json(event.source)},
                {"event_time", event.event_time},
                {"received_time", event.received_time},
                {"content_type", event.content_type},
                {"raw_payload", event.raw_payload},
                {"ocsf", event.ocsf}};
    if (!event.mapping.is_null()) {
        result["mapping"] = event.mapping;
    }
    return result;
}

[[nodiscard]] HeartbeatStatus parse_heartbeat_status(const std::string_view value) {
    if (value == "online") {
        return HeartbeatStatus::online;
    }
    if (value == "degraded") {
        return HeartbeatStatus::degraded;
    }
    if (value == "shutting_down") {
        return HeartbeatStatus::shutting_down;
    }
    fail("invalid_enum", "$.status", "unsupported heartbeat status");
}

[[nodiscard]] RejectionStage parse_rejection_stage(const std::string_view value) {
    if (value == "input_validation") {
        return RejectionStage::input_validation;
    }
    fail("invalid_enum", "$.rejection.stage", "unsupported rejection stage");
}

[[nodiscard]] RejectionCode parse_rejection_code(const std::string_view value) {
    static constexpr std::array values{
        std::pair{"invalid_json", RejectionCode::invalid_json},
        std::pair{"invalid_utf8", RejectionCode::invalid_utf8},
        std::pair{"missing_required_field", RejectionCode::missing_required_field},
        std::pair{"invalid_field_type", RejectionCode::invalid_field_type},
        std::pair{"invalid_timestamp", RejectionCode::invalid_timestamp},
        std::pair{"invalid_ip_address", RejectionCode::invalid_ip_address},
        std::pair{"unsupported_event_type", RejectionCode::unsupported_event_type},
        std::pair{"record_too_large", RejectionCode::record_too_large},
        std::pair{"mapping_failed", RejectionCode::mapping_failed},
        std::pair{"ocsf_validation_failed", RejectionCode::ocsf_validation_failed},
    };
    const auto match = std::find_if(values.begin(), values.end(), [value](const auto& entry) {
        return std::string_view{entry.first} == value;
    });
    if (match == values.end()) {
        fail("invalid_enum", "$.rejection.code", "unsupported rejection code");
    }
    return match->second;
}

[[nodiscard]] Json heartbeat_metrics_to_json(const HeartbeatMetrics& metrics) {
    return Json{{"events_received", metrics.events_received},
                {"events_published", metrics.events_published},
                {"events_rejected", metrics.events_rejected},
                {"events_lost_best_effort", metrics.events_lost_best_effort},
                {"queue_events", metrics.queue_events},
                {"queue_bytes", metrics.queue_bytes},
                {"outbox_batches", metrics.outbox_batches},
                {"outbox_bytes", metrics.outbox_bytes},
                {"last_batch_id", metrics.last_batch_id.has_value()
                      ? Json(*metrics.last_batch_id)
                      : Json(nullptr)},
                {"cpu_percent", metrics.cpu_percent},
                {"memory_bytes", metrics.memory_bytes},
                {"disk_available_bytes", metrics.disk_available_bytes}};
}

void validate_heartbeat_metrics(const HeartbeatMetrics& metrics, const std::string_view path) {
    const std::array counters{
        std::pair{"events_received", metrics.events_received},
        std::pair{"events_published", metrics.events_published},
        std::pair{"events_rejected", metrics.events_rejected},
        std::pair{"events_lost_best_effort", metrics.events_lost_best_effort},
        std::pair{"queue_events", metrics.queue_events},
        std::pair{"queue_bytes", metrics.queue_bytes},
        std::pair{"outbox_batches", metrics.outbox_batches},
        std::pair{"outbox_bytes", metrics.outbox_bytes},
        std::pair{"memory_bytes", metrics.memory_bytes},
        std::pair{"disk_available_bytes", metrics.disk_available_bytes},
    };
    for (const auto& [name, value] : counters) {
        if (value > maximum_safe_json_integer) {
            fail("unsafe_number", std::string{path} + "." + name,
                 "integer exceeds the safe JSON range");
        }
    }
    if (metrics.cpu_percent < 0.0 || metrics.cpu_percent > 100.0 ||
        !std::isfinite(metrics.cpu_percent)) {
        fail("invalid_numeric_value", std::string{path} + ".cpu_percent",
             "must be finite and between 0 and 100");
    }
    if (metrics.last_batch_id.has_value()) {
        validate_uuid(*metrics.last_batch_id, std::string{path} + ".last_batch_id");
    }
}

[[nodiscard]] HeartbeatMetrics parse_heartbeat_metrics(const Json& value,
                                                       const std::string_view path) {
    require_exact_keys(value, path,
                       {"events_received", "events_published", "events_rejected",
                        "events_lost_best_effort", "queue_events", "queue_bytes",
                        "outbox_batches", "outbox_bytes", "last_batch_id", "cpu_percent",
                        "memory_bytes", "disk_available_bytes"});
    HeartbeatMetrics metrics;
    metrics.events_received = require_safe_unsigned(value, "events_received", path);
    metrics.events_published = require_safe_unsigned(value, "events_published", path);
    metrics.events_rejected = require_safe_unsigned(value, "events_rejected", path);
    metrics.events_lost_best_effort =
        require_safe_unsigned(value, "events_lost_best_effort", path);
    metrics.queue_events = require_safe_unsigned(value, "queue_events", path);
    metrics.queue_bytes = require_safe_unsigned(value, "queue_bytes", path);
    metrics.outbox_batches = require_safe_unsigned(value, "outbox_batches", path);
    metrics.outbox_bytes = require_safe_unsigned(value, "outbox_bytes", path);
    metrics.cpu_percent = require_number(value, "cpu_percent", path);
    metrics.memory_bytes = require_safe_unsigned(value, "memory_bytes", path);
    metrics.disk_available_bytes = require_safe_unsigned(value, "disk_available_bytes", path);

    if (metrics.cpu_percent < 0.0 || metrics.cpu_percent > 100.0) {
        fail("invalid_numeric_value", std::string{path} + ".cpu_percent",
             "must be between 0 and 100");
    }
    const auto& last_batch = value.at("last_batch_id");
    if (!last_batch.is_null()) {
        if (!last_batch.is_string()) {
            fail("invalid_field_type", std::string{path} + ".last_batch_id",
                 "must be UUIDv4 or null");
        }
        metrics.last_batch_id = last_batch.get<std::string>();
        validate_uuid(*metrics.last_batch_id, std::string{path} + ".last_batch_id");
    }
    return metrics;
}

[[nodiscard]] Json rejected_source_to_json(const RejectedSource& source) {
    return Json{{"source_id", source.source_id},
                {"adapter_type", source.adapter_type},
                {"file_identity", source.file_identity},
                {"record_start_offset", source.record_start_offset},
                {"record_end_offset", source.record_end_offset}};
}

[[nodiscard]] RejectedSource parse_rejected_source(const Json& value,
                                                   const std::string_view path) {
    require_exact_keys(value, path,
                       {"source_id", "adapter_type", "file_identity", "record_start_offset",
                        "record_end_offset"});
    RejectedSource source{require_string(value, "source_id", path),
                          require_string(value, "adapter_type", path),
                          require_string(value, "file_identity", path),
                          require_safe_unsigned(value, "record_start_offset", path),
                          require_safe_unsigned(value, "record_end_offset", path)};
    validate_nonempty(source.source_id, std::string{path} + ".source_id");
    validate_nonempty(source.adapter_type, std::string{path} + ".adapter_type");
    validate_nonempty(source.file_identity, std::string{path} + ".file_identity");
    if (source.record_end_offset < source.record_start_offset) {
        fail("invalid_offset_range", std::string{path} + ".record_end_offset",
             "must not precede record_start_offset");
    }
    return source;
}

[[nodiscard]] Json rejection_to_json(const Rejection& rejection) {
    return Json{{"stage", std::string{to_string(rejection.stage)}},
                {"code", std::string{to_string(rejection.code)}},
                {"message", rejection.message}};
}

[[nodiscard]] Rejection parse_rejection(const Json& value, const std::string_view path) {
    require_exact_keys(value, path, {"stage", "code", "message"});
    Rejection rejection{parse_rejection_stage(require_string(value, "stage", path)),
                        parse_rejection_code(require_string(value, "code", path)),
                        require_string(value, "message", path)};
    validate_nonempty(rejection.message, std::string{path} + ".message");
    return rejection;
}

[[nodiscard]] Json rejected_payload_to_json(const RejectedPayload& payload) {
    return Json{{"content_type", payload.content_type},
                {"byte_length", payload.byte_length},
                {"sha256", payload.sha256},
                {"capture_encoding", payload.capture_encoding},
                {"capture", payload.capture},
                {"capture_truncated", payload.capture_truncated}};
}

void validate_rejected_payload(const RejectedPayload& payload, const std::string_view path) {
    validate_nonempty(payload.content_type, std::string{path} + ".content_type");
    if (!is_lower_hex(payload.sha256, 64U)) {
        fail("invalid_sha256", std::string{path} + ".sha256",
             "must be 64 lowercase hexadecimal characters");
    }
    if (payload.capture_encoding != "base64") {
        fail("invalid_enum", std::string{path} + ".capture_encoding", "must be base64");
    }
    if (payload.byte_length > maximum_safe_json_integer) {
        fail("unsafe_number", std::string{path} + ".byte_length",
             "integer exceeds the safe JSON range");
    }
    const auto captured_size = decoded_base64_size(payload.capture);
    if (!captured_size.has_value()) {
        fail("invalid_base64", std::string{path} + ".capture", "must be canonical base64");
    }
    if (*captured_size > maximum_rejected_capture_bytes) {
        fail("capture_too_large", std::string{path} + ".capture",
             "decoded capture exceeds 64 KiB");
    }
    if (payload.capture_truncated) {
        if (payload.byte_length <= maximum_rejected_capture_bytes ||
            *captured_size != maximum_rejected_capture_bytes) {
            fail("invalid_capture_length", std::string{path} + ".capture_truncated",
                 "truncated records must capture the first 64 KiB of a larger payload");
        }
    } else if (*captured_size != payload.byte_length) {
        fail("invalid_capture_length", std::string{path} + ".capture",
             "complete capture size must equal byte_length");
    }
}

[[nodiscard]] RejectedPayload parse_rejected_payload(const Json& value,
                                                     const std::string_view path) {
    require_exact_keys(value, path,
                       {"content_type", "byte_length", "sha256", "capture_encoding", "capture",
                        "capture_truncated"});
    if (!value.at("capture_truncated").is_boolean()) {
        fail("invalid_field_type", std::string{path} + ".capture_truncated",
             "expected a boolean");
    }
    RejectedPayload payload{require_string(value, "content_type", path),
                            require_safe_unsigned(value, "byte_length", path),
                            require_string(value, "sha256", path),
                            require_string(value, "capture_encoding", path),
                            require_string(value, "capture", path),
                            value.at("capture_truncated").get<bool>()};
    validate_rejected_payload(payload, path);
    return payload;
}

} // namespace

ContractError::ContractError(std::string code, std::string path, std::string message)
    : std::runtime_error{code + " at " + path + ": " + message}, code_{std::move(code)},
      path_{std::move(path)} {}

Json parse_json_strict(const std::string_view input) {
    if (input.size() > ContractProfile::maximum_encoded_batch_bytes) {
        fail("document_too_large", "$", "document exceeds the 8 MiB contract limit");
    }
    if (input.size() >= 3U && static_cast<unsigned char>(input[0]) == 0xEFU &&
        static_cast<unsigned char>(input[1]) == 0xBBU &&
        static_cast<unsigned char>(input[2]) == 0xBFU) {
        fail("invalid_bom", "$", "UTF-8 BOM is forbidden");
    }

    JsonSafetyScanner scanner;
    if (!Json::sax_parse(input.begin(), input.end(), &scanner, Json::input_format_t::json, true)) {
        fail("invalid_json", "$", scanner.error().empty() ? "malformed JSON" : scanner.error());
    }

    try {
        return Json::parse(input.begin(), input.end(), nullptr, true, false);
    } catch (const Json::exception& exception) {
        fail("invalid_json", "$", exception.what());
    }
}

Json to_json_document(const EventBatch& batch, const bool include_signature) {
    if (batch.contract_version != ContractProfile::contract_version) {
        fail("unsupported_contract_version", "$.contract_version", "must be 1.0.0");
    }
    if (batch.message_type != ContractProfile::event_batch_message_type) {
        fail("invalid_message_type", "$.message_type", "must be event_batch");
    }
    validate_uuid(batch.batch_id, "$.batch_id");
    validate_collector_id(batch.collector_id, "$.collector_id");
    validate_timestamp(batch.created_at, "$.created_at");
    if (batch.ocsf_schema_version != ContractProfile::ocsf_schema_version) {
        fail("unsupported_ocsf_version", "$.ocsf_schema_version", "must be 1.1.0");
    }
    if (batch.events.size() > ContractProfile::maximum_events_per_batch) {
        fail("too_many_events", "$.events", "batch exceeds the 1,000 event limit");
    }
    validate_integrity(batch.integrity,
                       include_signature ? SignatureRequirement::required
                                         : SignatureRequirement::allow_unsigned,
                       "$.integrity");

    Json events = Json::array();
    for (std::size_t index = 0; index < batch.events.size(); ++index) {
        validate_event(batch.events[index], "$.events[" + std::to_string(index) + "]");
        events.push_back(event_to_json(batch.events[index]));
    }

    return Json{{"contract_version", batch.contract_version},
                {"message_type", batch.message_type},
                {"batch_id", batch.batch_id},
                {"collector_id", batch.collector_id},
                {"created_at", batch.created_at},
                {"ocsf_schema_version", batch.ocsf_schema_version},
                {"event_count", batch.event_count()},
                {"events", std::move(events)},
                {"integrity", integrity_to_json(batch.integrity, include_signature)}};
}

Json to_json_document(const Heartbeat& heartbeat, const bool include_signature) {
    if (heartbeat.contract_version != ContractProfile::contract_version) {
        fail("unsupported_contract_version", "$.contract_version", "must be 1.0.0");
    }
    if (heartbeat.message_type != ContractProfile::heartbeat_message_type) {
        fail("invalid_message_type", "$.message_type", "must be heartbeat");
    }
    validate_collector_id(heartbeat.collector_id, "$.collector_id");
    if (heartbeat.sequence > maximum_safe_json_integer) {
        fail("unsafe_number", "$.sequence", "integer exceeds the safe JSON range");
    }
    validate_timestamp(heartbeat.timestamp, "$.timestamp");
    validate_timestamp(heartbeat.started_at, "$.started_at");
    validate_nonempty(heartbeat.collector_version, "$.collector_version");
    validate_nonempty(heartbeat.configuration_version, "$.configuration_version");
    validate_heartbeat_metrics(heartbeat.metrics, "$.metrics");
    validate_integrity(heartbeat.integrity,
                       include_signature ? SignatureRequirement::required
                                         : SignatureRequirement::allow_unsigned,
                       "$.integrity");
    return Json{{"contract_version", heartbeat.contract_version},
                {"message_type", heartbeat.message_type},
                {"collector_id", heartbeat.collector_id},
                {"sequence", heartbeat.sequence},
                {"timestamp", heartbeat.timestamp},
                {"started_at", heartbeat.started_at},
                {"collector_version", heartbeat.collector_version},
                {"configuration_version", heartbeat.configuration_version},
                {"status", std::string{to_string(heartbeat.status)}},
                {"metrics", heartbeat_metrics_to_json(heartbeat.metrics)},
                {"integrity", integrity_to_json(heartbeat.integrity, include_signature)}};
}

Json to_json_document(const RejectedEvent& rejected, const bool include_signature) {
    if (rejected.contract_version != ContractProfile::contract_version) {
        fail("unsupported_contract_version", "$.contract_version", "must be 1.0.0");
    }
    if (rejected.message_type != ContractProfile::rejected_event_message_type) {
        fail("invalid_message_type", "$.message_type", "must be rejected_event");
    }
    validate_uuid(rejected.rejection_id, "$.rejection_id");
    validate_collector_id(rejected.collector_id, "$.collector_id");
    validate_timestamp(rejected.rejected_at, "$.rejected_at");
    validate_nonempty(rejected.source.source_id, "$.source.source_id");
    validate_nonempty(rejected.source.adapter_type, "$.source.adapter_type");
    validate_nonempty(rejected.source.file_identity, "$.source.file_identity");
    if (rejected.source.record_start_offset > maximum_safe_json_integer ||
        rejected.source.record_end_offset > maximum_safe_json_integer) {
        fail("unsafe_number", "$.source", "record offsets exceed the safe JSON range");
    }
    if (rejected.source.record_end_offset < rejected.source.record_start_offset) {
        fail("invalid_offset_range", "$.source.record_end_offset",
             "must not precede record_start_offset");
    }
    validate_nonempty(rejected.rejection.message, "$.rejection.message");
    validate_rejected_payload(rejected.payload, "$.payload");
    validate_integrity(rejected.integrity,
                       include_signature ? SignatureRequirement::required
                                         : SignatureRequirement::allow_unsigned,
                       "$.integrity");
    return Json{{"contract_version", rejected.contract_version},
                {"message_type", rejected.message_type},
                {"rejection_id", rejected.rejection_id},
                {"collector_id", rejected.collector_id},
                {"rejected_at", rejected.rejected_at},
                {"source", rejected_source_to_json(rejected.source)},
                {"rejection", rejection_to_json(rejected.rejection)},
                {"payload", rejected_payload_to_json(rejected.payload)},
                {"integrity", integrity_to_json(rejected.integrity, include_signature)}};
}

std::string serialize(const EventBatch& batch, const bool include_signature) {
    const auto result = dump_strict(to_json_document(batch, include_signature));
    if (result.size() > ContractProfile::maximum_encoded_batch_bytes) {
        fail("document_too_large", "$", "serialized batch exceeds the 8 MiB contract limit");
    }
    return result;
}

std::string serialize(const Heartbeat& heartbeat, const bool include_signature) {
    return dump_strict(to_json_document(heartbeat, include_signature));
}

std::string serialize(const RejectedEvent& rejected, const bool include_signature) {
    return dump_strict(to_json_document(rejected, include_signature));
}

EventBatch parse_event_batch(const std::string_view input, const SignatureRequirement signature) {
    const auto document = parse_json_strict(input);
    require_exact_keys(document, "$",
                       {"contract_version", "message_type", "batch_id", "collector_id",
                        "created_at", "ocsf_schema_version", "event_count", "events",
                        "integrity"});
    EventBatch batch;
    batch.contract_version = require_string(document, "contract_version", "$");
    batch.message_type = require_string(document, "message_type", "$");
    batch.batch_id = require_string(document, "batch_id", "$");
    batch.collector_id = require_string(document, "collector_id", "$");
    batch.created_at = require_string(document, "created_at", "$");
    batch.ocsf_schema_version = require_string(document, "ocsf_schema_version", "$");
    const auto declared_count = require_safe_unsigned(document, "event_count", "$");
    if (!document.at("events").is_array()) {
        fail("invalid_field_type", "$.events", "expected an array");
    }
    for (std::size_t index = 0; index < document.at("events").size(); ++index) {
        batch.events.push_back(
            parse_event(document.at("events").at(index), "$.events[" + std::to_string(index) + "]"));
    }
    if (declared_count != batch.event_count()) {
        fail("event_count_mismatch", "$.event_count", "must equal events.length");
    }
    batch.integrity = parse_integrity(document.at("integrity"), signature, "$.integrity");
    static_cast<void>(to_json_document(batch, signature == SignatureRequirement::required));
    return batch;
}

Heartbeat parse_heartbeat(const std::string_view input, const SignatureRequirement signature) {
    const auto document = parse_json_strict(input);
    require_exact_keys(document, "$",
                       {"contract_version", "message_type", "collector_id", "sequence",
                        "timestamp", "started_at", "collector_version", "configuration_version",
                        "status", "metrics", "integrity"});
    Heartbeat heartbeat;
    heartbeat.contract_version = require_string(document, "contract_version", "$");
    heartbeat.message_type = require_string(document, "message_type", "$");
    heartbeat.collector_id = require_string(document, "collector_id", "$");
    heartbeat.sequence = require_safe_unsigned(document, "sequence", "$");
    heartbeat.timestamp = require_string(document, "timestamp", "$");
    heartbeat.started_at = require_string(document, "started_at", "$");
    heartbeat.collector_version = require_string(document, "collector_version", "$");
    heartbeat.configuration_version = require_string(document, "configuration_version", "$");
    heartbeat.status = parse_heartbeat_status(require_string(document, "status", "$"));
    heartbeat.metrics = parse_heartbeat_metrics(document.at("metrics"), "$.metrics");
    heartbeat.integrity = parse_integrity(document.at("integrity"), signature, "$.integrity");
    static_cast<void>(to_json_document(heartbeat, signature == SignatureRequirement::required));
    return heartbeat;
}

RejectedEvent parse_rejected_event(const std::string_view input,
                                   const SignatureRequirement signature) {
    const auto document = parse_json_strict(input);
    require_exact_keys(document, "$",
                       {"contract_version", "message_type", "rejection_id", "collector_id",
                        "rejected_at", "source", "rejection", "payload", "integrity"});
    RejectedEvent rejected;
    rejected.contract_version = require_string(document, "contract_version", "$");
    rejected.message_type = require_string(document, "message_type", "$");
    rejected.rejection_id = require_string(document, "rejection_id", "$");
    rejected.collector_id = require_string(document, "collector_id", "$");
    rejected.rejected_at = require_string(document, "rejected_at", "$");
    rejected.source = parse_rejected_source(document.at("source"), "$.source");
    rejected.rejection = parse_rejection(document.at("rejection"), "$.rejection");
    rejected.payload = parse_rejected_payload(document.at("payload"), "$.payload");
    rejected.integrity = parse_integrity(document.at("integrity"), signature, "$.integrity");
    static_cast<void>(to_json_document(rejected, signature == SignatureRequirement::required));
    return rejected;
}

std::string_view to_string(const HeartbeatStatus status) noexcept {
    switch (status) {
    case HeartbeatStatus::online:
        return "online";
    case HeartbeatStatus::degraded:
        return "degraded";
    case HeartbeatStatus::shutting_down:
        return "shutting_down";
    }
    return "online";
}

std::string_view to_string(const RejectionStage stage) noexcept {
    switch (stage) {
    case RejectionStage::input_validation:
        return "input_validation";
    }
    return "input_validation";
}

std::string_view to_string(const RejectionCode code) noexcept {
    switch (code) {
    case RejectionCode::invalid_json:
        return "invalid_json";
    case RejectionCode::invalid_utf8:
        return "invalid_utf8";
    case RejectionCode::missing_required_field:
        return "missing_required_field";
    case RejectionCode::invalid_field_type:
        return "invalid_field_type";
    case RejectionCode::invalid_timestamp:
        return "invalid_timestamp";
    case RejectionCode::invalid_ip_address:
        return "invalid_ip_address";
    case RejectionCode::unsupported_event_type:
        return "unsupported_event_type";
    case RejectionCode::record_too_large:
        return "record_too_large";
    case RejectionCode::mapping_failed:
        return "mapping_failed";
    case RejectionCode::ocsf_validation_failed:
        return "ocsf_validation_failed";
    }
    return "invalid_json";
}

} // namespace trivikrama::collector::contract
