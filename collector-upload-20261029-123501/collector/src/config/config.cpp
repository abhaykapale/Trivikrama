#include "trivikrama/collector/config/config.hpp"

#include <algorithm>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::config {
namespace {

[[nodiscard]] bool is_base64url_secret(const std::string_view value) noexcept {
    return value.size() == SecretValue::encoded_size &&
           std::all_of(value.begin(), value.end(), [](const char character) {
               return (character >= 'A' && character <= 'Z') ||
                      (character >= 'a' && character <= 'z') ||
                      (character >= '0' && character <= '9') || character == '_' ||
                      character == '-';
           });
}

} // namespace

SecretValue::SecretValue(const std::string_view encoded) {
    if (!is_base64url_secret(encoded)) {
        throw std::invalid_argument{
            "HMAC secret must contain exactly 64 unpadded base64url characters"};
    }
    std::copy(encoded.begin(), encoded.end(), value_.begin());
}

SecretValue::~SecretValue() { clear(); }

SecretValue::SecretValue(SecretValue&& other) noexcept : value_{other.value_} { other.clear(); }

SecretValue& SecretValue::operator=(SecretValue&& other) noexcept {
    if (this != &other) {
        clear();
        value_ = other.value_;
        other.clear();
    }
    return *this;
}

std::string_view SecretValue::encoded() const noexcept { return {value_.data(), value_.size()}; }

std::string SecretValue::redacted() const { return "[REDACTED]"; }

void SecretValue::clear() noexcept {
    volatile char* cursor = value_.data();
    for (std::size_t index = 0; index < value_.size(); ++index) {
        cursor[index] = '\0';
    }
}

std::string_view to_string(const LogLevel value) noexcept {
    switch (value) {
    case LogLevel::trace:
        return "TRACE";
    case LogLevel::debug:
        return "DEBUG";
    case LogLevel::info:
        return "INFO";
    case LogLevel::warn:
        return "WARN";
    case LogLevel::error:
        return "ERROR";
    case LogLevel::critical:
        return "CRITICAL";
    }
    return "INFO";
}

std::string_view to_string(const LogFormat value) noexcept {
    switch (value) {
    case LogFormat::json:
        return "json";
    case LogFormat::text:
        return "text";
    }
    return "json";
}

std::string_view to_string(const SourceType value) noexcept {
    switch (value) {
    case SourceType::file_drop:
        return "file_drop";
    case SourceType::syslog:
        return "syslog";
    case SourceType::windows_event_forwarding:
        return "windows_event_forwarding";
    case SourceType::http:
        return "http";
    }
    return "file_drop";
}

std::string_view to_string(const StartPosition value) noexcept {
    switch (value) {
    case StartPosition::oldest:
        return "oldest";
    case StartPosition::newest:
        return "newest";
    }
    return "oldest";
}

std::string_view to_string(const UnknownFieldPolicy value) noexcept {
    switch (value) {
    case UnknownFieldPolicy::unmapped:
        return "unmapped";
    case UnknownFieldPolicy::drop:
        return "drop";
    case UnknownFieldPolicy::error:
        return "error";
    }
    return "unmapped";
}

} // namespace trivikrama::collector::config
