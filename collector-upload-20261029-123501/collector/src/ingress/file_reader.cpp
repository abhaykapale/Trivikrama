#include "trivikrama/collector/ingress/file_reader.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/contract/serialization.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

#ifdef _WIN32
#define NOMINMAX
#include <Windows.h>
#else
#include <sys/stat.h>
#endif

namespace trivikrama::collector::ingress {
namespace {

using contract::ContractProfile;
using contract::Json;
using contract::RejectionCode;

struct FileState final {
    std::string identity;
    std::uint64_t size{};
};

constexpr std::size_t anchor_size = 64U;
constexpr std::uint64_t maximum_safe_json_integer = 9'007'199'254'740'991ULL;

[[noreturn]] void fail(std::string code, std::string message) {
    throw FileReaderError{std::move(code), std::move(message)};
}

[[nodiscard]] FileState inspect_file(const std::filesystem::path& path) {
    std::error_code error;
    if (!std::filesystem::is_regular_file(path, error) || error) {
        fail("source_unavailable", "input is not an accessible regular file: " + path.string());
    }
    const auto file_size = std::filesystem::file_size(path, error);
    if (error || file_size > maximum_safe_json_integer) {
        fail("source_unavailable", "cannot determine input file size: " + path.string());
    }

#ifdef _WIN32
    const auto handle = ::CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
                                      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                      nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        fail("source_unavailable", "cannot inspect input file identity: " + path.string());
    }
    struct HandleGuard final {
        HANDLE value;
        ~HandleGuard() { static_cast<void>(::CloseHandle(value)); }
    } guard{handle};
    BY_HANDLE_FILE_INFORMATION information{};
    if (::GetFileInformationByHandle(handle, &information) == 0) {
        fail("source_unavailable", "cannot inspect input file identity: " + path.string());
    }
    std::ostringstream identity;
    identity << std::hex << information.dwVolumeSerialNumber << ':'
             << information.nFileIndexHigh << ':' << information.nFileIndexLow;
#else
    struct stat information {};
    if (::stat(path.c_str(), &information) != 0) {
        fail("source_unavailable", "cannot inspect input file identity: " + path.string());
    }
    std::ostringstream identity;
    identity << information.st_dev << ':' << information.st_ino;
#endif

    return FileState{identity.str(), static_cast<std::uint64_t>(file_size)};
}

[[nodiscard]] std::string read_anchor(const std::filesystem::path& path,
                                      const std::uint64_t end_offset) {
    const auto length = static_cast<std::size_t>(
        std::min<std::uint64_t>(end_offset, static_cast<std::uint64_t>(anchor_size)));
    if (length == 0U) {
        return {};
    }
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        fail("source_unavailable", "cannot open input file: " + path.string());
    }
    input.seekg(static_cast<std::streamoff>(end_offset - length), std::ios::beg);
    std::string value(length, '\0');
    input.read(value.data(), static_cast<std::streamsize>(length));
    if (input.gcount() != static_cast<std::streamsize>(length)) {
        fail("source_read_failed", "cannot verify input file continuity: " + path.string());
    }
    return value;
}

[[nodiscard]] bool is_valid_utf8(const std::string_view value) noexcept {
    std::size_t index = 0U;
    while (index < value.size()) {
        const auto first = static_cast<unsigned char>(value[index]);
        std::size_t continuation_count = 0U;
        std::uint32_t code_point = 0U;
        if (first <= 0x7FU) {
            ++index;
            continue;
        }
        if (first >= 0xC2U && first <= 0xDFU) {
            continuation_count = 1U;
            code_point = first & 0x1FU;
        } else if (first >= 0xE0U && first <= 0xEFU) {
            continuation_count = 2U;
            code_point = first & 0x0FU;
        } else if (first >= 0xF0U && first <= 0xF4U) {
            continuation_count = 3U;
            code_point = first & 0x07U;
        } else {
            return false;
        }
        if (index + continuation_count >= value.size()) {
            return false;
        }
        for (std::size_t offset = 1U; offset <= continuation_count; ++offset) {
            const auto next = static_cast<unsigned char>(value[index + offset]);
            if ((next & 0xC0U) != 0x80U) {
                return false;
            }
            code_point = (code_point << 6U) | (next & 0x3FU);
        }
        const auto overlong = (continuation_count == 1U && code_point < 0x80U) ||
                              (continuation_count == 2U && code_point < 0x800U) ||
                              (continuation_count == 3U && code_point < 0x10000U);
        if (overlong || code_point > 0x10FFFFU ||
            (code_point >= 0xD800U && code_point <= 0xDFFFU)) {
            return false;
        }
        index += continuation_count + 1U;
    }
    return true;
}

[[nodiscard]] std::string required_envelope_string(const Json& document,
                                                   const std::string_view field) {
    const std::string key{field};
    if (!document.contains(key)) {
        throw FileReaderError{"missing_required_field",
                              "required input field is absent: " + key};
    }
    if (!document.at(key).is_string()) {
        throw FileReaderError{"invalid_field_type", "input field must be a string: " + key};
    }
    const auto value = document.at(key).get<std::string>();
    if (value.empty()) {
        throw FileReaderError{"missing_required_field", "input field must not be empty: " + key};
    }
    return value;
}

[[nodiscard]] InputRejection make_rejection(
    const FileReaderOptions& options, const std::string& identity,
    const std::uint64_t start_offset, const std::uint64_t end_offset,
    const std::string_view payload, const std::uint64_t byte_length,
    const RejectionCode code, std::string message, std::string payload_sha256) {
    const auto capture_size = std::min(payload.size(), options.maximum_capture_bytes);
    return InputRejection{code,
                          std::move(message),
                          options.source_id,
                          "file_drop",
                          identity,
                          start_offset,
                          end_offset,
                          "application/json",
                          byte_length,
                          std::string{payload.substr(0U, capture_size)},
                          byte_length > capture_size,
                          std::move(payload_sha256)};
}

} // namespace

std::string SystemUtcClock::now() const {
    const auto now = std::chrono::system_clock::now();
    const auto time = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#ifdef _WIN32
    if (::gmtime_s(&utc, &time) != 0) {
#else
    if (::gmtime_r(&time, &utc) == nullptr) {
#endif
        fail("clock_failure", "cannot convert the current time to UTC");
    }
    std::ostringstream result;
    const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(
                                  now.time_since_epoch()) %
                              std::chrono::seconds{1};
    result << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S.") << std::setfill('0')
           << std::setw(3) << milliseconds.count() << 'Z';
    return result.str();
}

FileReaderError::FileReaderError(std::string code, std::string message)
    : std::runtime_error{code + ": " + message}, code_{std::move(code)} {}

FileReader::FileReader(FileReaderOptions options, const IUtcClock& clock)
    : options_{std::move(options)}, clock_{clock} {
    if (options_.source_id.empty()) {
        fail("invalid_options", "source_id must not be empty");
    }
    if (options_.path.empty()) {
        fail("invalid_options", "path must not be empty");
    }
    if (options_.upstream_sender_id.empty()) {
        fail("invalid_options", "upstream_sender_id must not be empty");
    }
    if (options_.maximum_record_bytes == 0U) {
        options_.maximum_record_bytes = ContractProfile::maximum_encoded_event_bytes;
    }
    if (options_.maximum_record_bytes > ContractProfile::maximum_encoded_event_bytes) {
        fail("invalid_options", "maximum_record_bytes exceeds the 512 KiB contract limit");
    }
    if (options_.maximum_capture_bytes == 0U) {
        fail("invalid_options", "maximum_capture_bytes must be positive");
    }
    if (options_.maximum_poll_bytes == 0U) {
        fail("invalid_options", "maximum_poll_bytes must be positive");
    }
    pending_payload_.reserve(
        std::min(options_.maximum_record_bytes + 1U, options_.maximum_capture_bytes));
}

void FileReader::reset_pending(const std::uint64_t next_start_offset) {
    pending_start_offset_ = next_start_offset;
    pending_byte_length_ = 0U;
    pending_payload_.clear();
    pending_last_character_ = '\0';
    pending_digest_.reset();
}

void FileReader::initialize_or_refresh_file() {
    const auto state = inspect_file(options_.path);
    if (!initialized_) {
        file_identity_ = state.identity;
        if (options_.resume_position.has_value() &&
            options_.resume_position->file_identity == state.identity &&
            options_.resume_position->end_offset <= state.size) {
            read_offset_ = options_.resume_position->end_offset;
        } else {
            read_offset_ =
                options_.start_position == config::StartPosition::newest ? state.size : 0U;
        }
        reset_pending(read_offset_);
        read_anchor_ = read_anchor(options_.path, read_offset_);
        initialized_ = true;
        return;
    }
    const auto can_verify_anchor =
        state.identity == file_identity_ && state.size >= read_offset_ && !read_anchor_.empty();
    const auto content_changed =
        can_verify_anchor && read_anchor(options_.path, read_offset_) != read_anchor_;
    if (state.identity != file_identity_ || state.size < read_offset_ || content_changed) {
        file_identity_ = state.identity;
        read_offset_ = 0U;
        reset_pending(0U);
        read_anchor_.clear();
    }
}

ReadItem FileReader::finish_record(const std::uint64_t end_offset) {
    auto payload = pending_payload_;
    auto byte_length = pending_byte_length_;
    if (pending_last_character_ == '\r') {
        if (!payload.empty() && payload.back() == '\r') {
            payload.pop_back();
        }
        --byte_length;
    } else if (pending_byte_length_ != 0U) {
        pending_digest_.update(std::string_view{&pending_last_character_, 1U});
    }
    auto payload_sha256 = pending_digest_.finish_hex();

    if (byte_length > options_.maximum_record_bytes) {
        return make_rejection(options_, file_identity_, pending_start_offset_, end_offset,
                              payload, byte_length, RejectionCode::record_too_large,
                              "input record exceeds the configured byte limit",
                              std::move(payload_sha256));
    }
    if (!is_valid_utf8(payload)) {
        return make_rejection(options_, file_identity_, pending_start_offset_, end_offset,
                              payload, byte_length, RejectionCode::invalid_utf8,
                              "input record is not valid UTF-8", std::move(payload_sha256));
    }

    Json document;
    try {
        document = contract::parse_json_strict(payload);
    } catch (const contract::ContractError& error) {
        return make_rejection(options_, file_identity_, pending_start_offset_, end_offset,
                              payload, byte_length, RejectionCode::invalid_json,
                              "input record is not strict JSON: " + error.code(),
                              std::move(payload_sha256));
    }
    if (!document.is_object()) {
        return make_rejection(options_, file_identity_, pending_start_offset_, end_offset,
                              payload, byte_length, RejectionCode::invalid_field_type,
                              "input record root must be a JSON object",
                              std::move(payload_sha256));
    }

    try {
        const auto upstream_event_id = required_envelope_string(document, "event_id");
        const auto endpoint_id = required_envelope_string(document, "endpoint_id");
        static_cast<void>(required_envelope_string(document, "event_type"));
        const auto event_time = required_envelope_string(document, "timestamp");
        return RawEvent{options_.source_id,
                        "file",
                        options_.upstream_sender_id,
                        endpoint_id,
                        upstream_event_id,
                        Json{{"file_identity", file_identity_},
                             {"record_start_offset", pending_start_offset_},
                             {"record_end_offset", end_offset}},
                        event_time,
                        clock_.now(),
                        "application/json",
                        std::move(payload),
                        std::move(document),
                        Json{{"boundary", "filesystem_acl"}}};
    } catch (const FileReaderError& error) {
        const auto code = error.code() == "missing_required_field"
                              ? RejectionCode::missing_required_field
                              : RejectionCode::invalid_field_type;
        return make_rejection(options_, file_identity_, pending_start_offset_, end_offset,
                              payload, byte_length, code, error.what(),
                              std::move(payload_sha256));
    }
}

FileReadResult FileReader::poll(const std::size_t maximum_records) {
    if (maximum_records == 0U) {
        fail("invalid_poll_limit", "maximum_records must be positive");
    }
    initialize_or_refresh_file();
    const auto identity_at_open = file_identity_;

    std::ifstream input{options_.path, std::ios::binary};
    if (!input) {
        fail("source_unavailable", "cannot open input file: " + options_.path.string());
    }
    input.seekg(static_cast<std::streamoff>(read_offset_), std::ios::beg);
    if (!input) {
        fail("source_seek_failed", "cannot seek input file: " + options_.path.string());
    }

    FileReadResult result;
    result.file_identity = file_identity_;
    std::size_t bytes_read = 0U;
    char character{};
    while (result.items.size() < maximum_records && bytes_read < options_.maximum_poll_bytes &&
           input.get(character)) {
        ++bytes_read;
        ++read_offset_;
        read_anchor_.push_back(character);
        if (read_anchor_.size() > anchor_size) {
            read_anchor_.erase(0U, read_anchor_.size() - anchor_size);
        }
        if (character == '\n') {
            result.items.push_back(finish_record(read_offset_));
            reset_pending(read_offset_);
            continue;
        }
        if (pending_byte_length_ != 0U) {
            pending_digest_.update(std::string_view{&pending_last_character_, 1U});
        }
        ++pending_byte_length_;
        pending_last_character_ = character;
        const auto storage_limit = std::max(options_.maximum_record_bytes + 1U,
                                            options_.maximum_capture_bytes);
        if (pending_payload_.size() < storage_limit) {
            pending_payload_.push_back(character);
        }
    }
    if (input.bad()) {
        fail("source_read_failed", "cannot read input file: " + options_.path.string());
    }

    const auto state_after_read = inspect_file(options_.path);
    const auto anchor_changed =
        state_after_read.identity == identity_at_open && state_after_read.size >= read_offset_ &&
        read_anchor(options_.path, read_offset_) != read_anchor_;
    if (state_after_read.identity != identity_at_open || state_after_read.size < read_offset_ ||
        anchor_changed) {
        file_identity_ = state_after_read.identity;
        read_offset_ = 0U;
        reset_pending(0U);
        read_anchor_.clear();
        fail("source_changed_during_read", "input changed while it was being read");
    }
    result.next_offset = read_offset_;
    result.has_partial_record = pending_byte_length_ != 0U;
    return result;
}

} // namespace trivikrama::collector::ingress
