#pragma once

#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/ingress/raw_event.hpp"
#include "trivikrama/collector/security/payload_encoding.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace trivikrama::collector::ingress {

class IUtcClock {
  public:
    virtual ~IUtcClock() = default;
    [[nodiscard]] virtual std::string now() const = 0;
};

class SystemUtcClock final : public IUtcClock {
  public:
    [[nodiscard]] std::string now() const override;
};

class FileReaderError final : public std::runtime_error {
  public:
    FileReaderError(std::string code, std::string message);

    [[nodiscard]] const std::string& code() const noexcept { return code_; }

  private:
    std::string code_;
};

struct FileReaderOptions final {
    std::string source_id;
    std::filesystem::path path;
    config::StartPosition start_position{config::StartPosition::oldest};
    std::string upstream_sender_id;
    std::size_t maximum_record_bytes{};
    std::size_t maximum_capture_bytes{64U * 1024U};
    std::size_t maximum_poll_bytes{4U * 1024U * 1024U};
    struct ResumePosition final {
        std::string file_identity;
        std::uint64_t end_offset{};
    };
    std::optional<ResumePosition> resume_position{};
};

using ReadItem = std::variant<RawEvent, InputRejection>;

struct FileReadResult final {
    std::vector<ReadItem> items;
    std::string file_identity;
    std::uint64_t next_offset{};
    bool has_partial_record{};
};

class FileReader final {
  public:
    explicit FileReader(FileReaderOptions options, const IUtcClock& clock);

    [[nodiscard]] FileReadResult poll(std::size_t maximum_records);
    [[nodiscard]] std::uint64_t read_offset() const noexcept { return read_offset_; }
    [[nodiscard]] std::string_view file_identity() const noexcept { return file_identity_; }

  private:
    [[nodiscard]] ReadItem finish_record(std::uint64_t end_offset);
    void reset_pending(std::uint64_t next_start_offset);
    void initialize_or_refresh_file();

    FileReaderOptions options_;
    const IUtcClock& clock_;
    std::string file_identity_;
    std::uint64_t read_offset_{};
    std::uint64_t pending_start_offset_{};
    std::uint64_t pending_byte_length_{};
    std::string pending_payload_;
    char pending_last_character_{};
    std::string read_anchor_;
    security::Sha256Accumulator pending_digest_;
    bool initialized_{};
};

} // namespace trivikrama::collector::ingress
