#pragma once

#include "trivikrama/collector/contract/contract_profile.hpp"

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace trivikrama::collector::config {

enum class LogLevel {
    trace,
    debug,
    info,
    warn,
    error,
    critical,
};

enum class LogFormat {
    json,
    text,
};

enum class SourceType {
    file_drop,
    syslog,
    windows_event_forwarding,
    http,
};

enum class StartPosition {
    oldest,
    newest,
};

enum class UnknownFieldPolicy {
    unmapped,
    drop,
    error,
};

class SecretValue final {
  public:
    static constexpr std::size_t encoded_size =
        contract::ContractProfile::encoded_secret_length;

    explicit SecretValue(std::string_view encoded);
    ~SecretValue();

    SecretValue(const SecretValue&) = delete;
    SecretValue& operator=(const SecretValue&) = delete;
    SecretValue(SecretValue&& other) noexcept;
    SecretValue& operator=(SecretValue&& other) noexcept;

    [[nodiscard]] std::string_view encoded() const noexcept;
    [[nodiscard]] std::string redacted() const;

  private:
    void clear() noexcept;

    std::array<char, encoded_size> value_{};
};

struct CollectorSettings final {
    std::string id;
    std::string configuration_version;
    LogLevel log_level{LogLevel::info};
    LogFormat log_format{LogFormat::json};
    std::filesystem::path log_file;
    std::uint32_t log_max_size_mb{10U};
    std::uint32_t log_max_files{5U};
};

struct OutputSettings final {
    std::filesystem::path directory;
    std::filesystem::path state_directory;
    std::filesystem::path outbox_directory;
    std::filesystem::path rejected_directory;
    std::filesystem::path checkpoint_file;
    std::chrono::seconds heartbeat_interval{
        contract::ContractProfile::heartbeat_interval};
};

struct SchedulerSettings final {
    std::chrono::milliseconds poll_interval{100};
    std::size_t batch_size{contract::ContractProfile::maximum_events_per_batch};
    std::chrono::seconds batch_timeout{
        contract::ContractProfile::maximum_batch_dwell_time};
    std::size_t queue_capacity_events{100'000U};
    std::uint64_t queue_capacity_bytes{64ULL * 1024ULL * 1024ULL};
};

struct OutboxSettings final {
    std::uint64_t maximum_bytes{contract::ContractProfile::maximum_outbox_bytes};
    std::size_t maximum_batches{contract::ContractProfile::maximum_outbox_batches};
    std::uint32_t warning_percent{80U};
    std::uint32_t critical_percent{95U};
};

struct SourceSettings final {
    std::string id;
    SourceType type{SourceType::file_drop};
    bool enabled{};
    std::filesystem::path path;
    StartPosition start_position{StartPosition::oldest};
};

struct OcsfSettings final {
    std::string schema_version{contract::ContractProfile::ocsf_schema_version};
    UnknownFieldPolicy unknown_field_policy{UnknownFieldPolicy::unmapped};
    std::filesystem::path custom_mappings_directory;
};

struct SecuritySettings final {
    std::string key_id;
    SecretValue hmac_secret;
};

struct CollectorConfig final {
    const CollectorSettings collector;
    const OutputSettings output;
    const SchedulerSettings scheduler;
    const OutboxSettings outbox;
    const std::vector<SourceSettings> sources;
    const OcsfSettings ocsf;
    const SecuritySettings security;
};

[[nodiscard]] std::string_view to_string(LogLevel value) noexcept;
[[nodiscard]] std::string_view to_string(LogFormat value) noexcept;
[[nodiscard]] std::string_view to_string(SourceType value) noexcept;
[[nodiscard]] std::string_view to_string(StartPosition value) noexcept;
[[nodiscard]] std::string_view to_string(UnknownFieldPolicy value) noexcept;

} // namespace trivikrama::collector::config
