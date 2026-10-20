#include "trivikrama/collector/config/config_loader.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"

#include <yaml-cpp/yaml.h>

#include <algorithm>
#include <array>
#include <charconv>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <io.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace trivikrama::collector::config {
namespace {

using contract::ContractProfile;

struct ParsedSecurity final {
    std::string key_id;
    std::optional<std::filesystem::path> secret_file;
};

struct ParsedConfiguration final {
    CollectorSettings collector;
    OutputSettings output;
    SchedulerSettings scheduler;
    OutboxSettings outbox;
    std::vector<SourceSettings> sources;
    OcsfSettings ocsf;
    ParsedSecurity security;
};

[[noreturn]] void fail(std::string code, std::string path, std::string message) {
    throw ConfigurationError{std::move(code), std::move(path), std::move(message)};
}

[[nodiscard]] std::string uppercase(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](const unsigned char character) {
        return static_cast<char>(std::toupper(character));
    });
    return value;
}

void require_map(const YAML::Node& node, const std::string_view path) {
    if (!node || !node.IsMap()) {
        fail("invalid_type", std::string{path}, "expected a YAML mapping");
    }
}

void require_sequence(const YAML::Node& node, const std::string_view path) {
    if (!node || !node.IsSequence()) {
        fail("invalid_type", std::string{path}, "expected a YAML sequence");
    }
}

void require_keys(const YAML::Node& node, const std::string_view path,
                  const std::initializer_list<std::string_view> required,
                  const std::initializer_list<std::string_view> optional = {}) {
    require_map(node, path);
    for (const auto key : required) {
        if (!node[std::string{key}]) {
            fail("missing_required_field", std::string{path} + "." + std::string{key},
                 "required configuration value is absent");
        }
    }
    std::set<std::string> observed;
    for (const auto& entry : node) {
        if (!entry.first.IsScalar()) {
            fail("invalid_key", std::string{path}, "mapping keys must be strings");
        }
        const auto key = entry.first.as<std::string>();
        if (!observed.insert(key).second) {
            fail("duplicate_field", std::string{path} + "." + key,
                 "configuration fields must be unique");
        }
        const auto accepted = [&key](const std::string_view candidate) { return key == candidate; };
        if (std::none_of(required.begin(), required.end(), accepted) &&
            std::none_of(optional.begin(), optional.end(), accepted)) {
            fail("unknown_field", std::string{path} + "." + key,
                 "configuration field is not recognized");
        }
    }
}

[[nodiscard]] std::string scalar_string(const YAML::Node& node, const std::string_view path) {
    if (!node || !node.IsScalar()) {
        fail("invalid_type", std::string{path}, "expected a scalar string");
    }
    try {
        return node.as<std::string>();
    } catch (const YAML::Exception& exception) {
        fail("invalid_value", std::string{path}, exception.what());
    }
}

[[nodiscard]] bool scalar_bool(const YAML::Node& node, const std::string_view path) {
    if (!node || !node.IsScalar()) {
        fail("invalid_type", std::string{path}, "expected a boolean");
    }
    try {
        return node.as<bool>();
    } catch (const YAML::Exception& exception) {
        fail("invalid_value", std::string{path}, exception.what());
    }
}

[[nodiscard]] std::uint64_t scalar_unsigned(const YAML::Node& node,
                                            const std::string_view path) {
    const auto text = scalar_string(node, path);
    std::uint64_t result{};
    const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), result);
    if (error != std::errc{} || end != text.data() + text.size()) {
        fail("invalid_integer", std::string{path}, "expected a nonnegative base-10 integer");
    }
    return result;
}

template <typename Target>
[[nodiscard]] Target checked_integer(const std::uint64_t value, const std::uint64_t minimum,
                                     const std::uint64_t maximum, const std::string_view path) {
    if (value < minimum || value > maximum) {
        fail("out_of_range", std::string{path},
             "must be between " + std::to_string(minimum) + " and " +
                 std::to_string(maximum));
    }
    return static_cast<Target>(value);
}

[[nodiscard]] std::filesystem::path resolve_yaml_path(const std::filesystem::path& config_path,
                                                      const std::string& raw) {
    const std::filesystem::path value{raw};
    if (value.is_absolute()) {
        return value.lexically_normal();
    }
    return (config_path.parent_path() / value).lexically_normal();
}

[[nodiscard]] std::filesystem::path required_yaml_path(
    const std::filesystem::path& config_path, const YAML::Node& node,
    const std::string_view field) {
    const auto raw = scalar_string(node, field);
    if (raw.empty()) {
        fail("empty_path", std::string{field}, "path must not be empty");
    }
    return resolve_yaml_path(config_path, raw);
}

[[nodiscard]] std::filesystem::path resolve_environment_path(const std::string& raw) {
    const std::filesystem::path value{raw};
    if (value.is_absolute()) {
        return value.lexically_normal();
    }
    return std::filesystem::absolute(value).lexically_normal();
}

[[nodiscard]] LogLevel parse_log_level(const std::string& raw, const std::string_view path) {
    const auto value = uppercase(raw);
    if (value == "TRACE") {
        return LogLevel::trace;
    }
    if (value == "DEBUG") {
        return LogLevel::debug;
    }
    if (value == "INFO") {
        return LogLevel::info;
    }
    if (value == "WARN") {
        return LogLevel::warn;
    }
    if (value == "ERROR") {
        return LogLevel::error;
    }
    if (value == "CRITICAL") {
        return LogLevel::critical;
    }
    fail("invalid_enum", std::string{path}, "unsupported log level");
}

[[nodiscard]] LogFormat parse_log_format(const std::string& value,
                                         const std::string_view path) {
    if (value == "json") {
        return LogFormat::json;
    }
    if (value == "text") {
        return LogFormat::text;
    }
    fail("invalid_enum", std::string{path}, "log format must be json or text");
}

[[nodiscard]] SourceType parse_source_type(const std::string& value,
                                           const std::string_view path) {
    if (value == "file_drop") {
        return SourceType::file_drop;
    }
    if (value == "syslog") {
        return SourceType::syslog;
    }
    if (value == "windows_event_forwarding") {
        return SourceType::windows_event_forwarding;
    }
    if (value == "http") {
        return SourceType::http;
    }
    fail("invalid_enum", std::string{path}, "unsupported central ingress adapter type");
}

[[nodiscard]] StartPosition parse_start_position(const std::string& value,
                                                 const std::string_view path) {
    if (value == "oldest") {
        return StartPosition::oldest;
    }
    if (value == "newest") {
        return StartPosition::newest;
    }
    fail("invalid_enum", std::string{path}, "start position must be oldest or newest");
}

[[nodiscard]] UnknownFieldPolicy parse_unknown_policy(const std::string& value,
                                                      const std::string_view path) {
    if (value == "unmapped") {
        return UnknownFieldPolicy::unmapped;
    }
    if (value == "drop") {
        return UnknownFieldPolicy::drop;
    }
    if (value == "error") {
        return UnknownFieldPolicy::error;
    }
    fail("invalid_enum", std::string{path}, "unsupported unknown-field policy");
}

[[nodiscard]] bool valid_identifier(const std::string_view value, const bool lowercase_only) {
    if (value.empty() || value.size() > 64U) {
        return false;
    }
    return std::all_of(value.begin(), value.end(), [lowercase_only](const char character) {
        const auto lower = character >= 'a' && character <= 'z';
        const auto upper = character >= 'A' && character <= 'Z';
        const auto digit = character >= '0' && character <= '9';
        return lower || (!lowercase_only && upper) || digit || character == '.' ||
               character == '_' || character == '-';
    });
}

[[nodiscard]] bool directory_is_writable(const std::filesystem::path& path) {
#ifdef _WIN32
    return ::_waccess(path.c_str(), 2) == 0;
#else
    return ::access(path.c_str(), W_OK) == 0;
#endif
}

void validate_directory(const std::filesystem::path& path, const std::string_view field) {
    std::error_code error;
    if (!std::filesystem::exists(path, error) || error ||
        !std::filesystem::is_directory(path, error) || error) {
        fail("invalid_directory", std::string{field},
             "directory does not exist or is not accessible: " + path.string());
    }
    if (!directory_is_writable(path)) {
        fail("directory_not_writable", std::string{field},
             "directory is not writable by the current process: " + path.string());
    }
}

[[nodiscard]] bool same_filesystem(const std::filesystem::path& left,
                                   const std::filesystem::path& right) {
#ifdef _WIN32
    return left.root_name() == right.root_name();
#else
    struct stat left_status {};
    struct stat right_status {};
    return ::stat(left.c_str(), &left_status) == 0 &&
           ::stat(right.c_str(), &right_status) == 0 &&
           left_status.st_dev == right_status.st_dev;
#endif
}

void validate_distinct_directories(const OutputSettings& output) {
    const std::array paths{std::filesystem::absolute(output.directory).lexically_normal(),
                           std::filesystem::absolute(output.state_directory).lexically_normal(),
                           std::filesystem::absolute(output.outbox_directory).lexically_normal(),
                           std::filesystem::absolute(output.rejected_directory).lexically_normal()};
    for (std::size_t left = 0; left < paths.size(); ++left) {
        for (std::size_t right = left + 1U; right < paths.size(); ++right) {
            if (paths[left] == paths[right]) {
                fail("directory_collision", "output",
                     "handoff, state, outbox, and rejected directories must be distinct");
            }
        }
    }
    if (!same_filesystem(paths[0], paths[2])) {
        fail("filesystem_mismatch", "output.outbox_directory",
             "handoff and outbox directories must use the same filesystem");
    }
}

[[nodiscard]] std::uint64_t parse_environment_unsigned(const std::string& value,
                                                       const std::string_view name) {
    std::uint64_t result{};
    const auto [end, error] =
        std::from_chars(value.data(), value.data() + value.size(), result);
    if (error != std::errc{} || end != value.data() + value.size()) {
        fail("invalid_environment", std::string{name}, "must be a nonnegative integer");
    }
    return result;
}

void apply_environment(ParsedConfiguration& config, const IEnvironment& environment) {
    if (const auto value = environment.get("COLLECTOR_ID")) {
        config.collector.id = *value;
    }
    if (const auto value = environment.get("COLLECTOR_LOG_LEVEL")) {
        config.collector.log_level = parse_log_level(*value, "COLLECTOR_LOG_LEVEL");
    }
    if (const auto value = environment.get("COLLECTOR_OUTPUT_DIR")) {
        if (value->empty()) {
            fail("invalid_environment", "COLLECTOR_OUTPUT_DIR", "path must not be empty");
        }
        config.output.directory = resolve_environment_path(*value);
    }
    if (const auto value = environment.get("COLLECTOR_BATCH_SIZE")) {
        config.scheduler.batch_size = checked_integer<std::size_t>(
            parse_environment_unsigned(*value, "COLLECTOR_BATCH_SIZE"), 1U,
            ContractProfile::maximum_events_per_batch, "COLLECTOR_BATCH_SIZE");
    }
    if (const auto value = environment.get("COLLECTOR_BATCH_TIMEOUT")) {
        const auto seconds = checked_integer<std::int64_t>(
            parse_environment_unsigned(*value, "COLLECTOR_BATCH_TIMEOUT"), 1U,
            static_cast<std::uint64_t>(ContractProfile::maximum_batch_dwell_time.count()),
            "COLLECTOR_BATCH_TIMEOUT");
        config.scheduler.batch_timeout = std::chrono::seconds{seconds};
    }
}

void clear_string(std::string& value) noexcept {
    volatile char* cursor = value.data();
    for (std::size_t index = 0; index < value.size(); ++index) {
        cursor[index] = '\0';
    }
    value.clear();
}

[[nodiscard]] std::string read_secret_file(const std::filesystem::path& path) {
#ifdef _WIN32
    std::error_code error;
    const auto status = std::filesystem::symlink_status(path, error);
    if (error || status.type() == std::filesystem::file_type::symlink ||
        status.type() != std::filesystem::file_type::regular) {
        fail("invalid_secret_file", "security.hmac_secret_file",
             "secret path must be a regular, non-symlink file");
    }
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        fail("secret_file_unreadable", "security.hmac_secret_file",
             "cannot read secret file");
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    auto value = buffer.str();
#else
    const auto descriptor = ::open(path.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (descriptor < 0) {
        fail("invalid_secret_file", "security.hmac_secret_file",
             "secret path must be a readable, regular, non-symlink file");
    }
    struct DescriptorGuard final {
        int value;
        ~DescriptorGuard() { static_cast<void>(::close(value)); }
    } guard{descriptor};

    struct stat status {};
    if (::fstat(descriptor, &status) != 0 || !S_ISREG(status.st_mode)) {
        fail("invalid_secret_file", "security.hmac_secret_file",
             "secret path must be a regular file");
    }
    if ((status.st_mode & (S_IRWXG | S_IRWXO)) != 0) {
        fail("insecure_secret_permissions", "security.hmac_secret_file",
             "secret file must not grant group or other permissions");
    }

    std::array<char, SecretValue::encoded_size + 3U> buffer{};
    std::size_t total = 0U;
    while (total < buffer.size()) {
        const auto count = ::read(descriptor, buffer.data() + total, buffer.size() - total);
        if (count < 0) {
            fail("secret_file_unreadable", "security.hmac_secret_file",
                 "cannot read secret file");
        }
        if (count == 0) {
            break;
        }
        total += static_cast<std::size_t>(count);
    }
    std::string value{buffer.data(), total};
    volatile char* cursor = buffer.data();
    for (std::size_t index = 0; index < buffer.size(); ++index) {
        cursor[index] = '\0';
    }
#endif
    if (value.size() > SecretValue::encoded_size + 2U) {
        clear_string(value);
        fail("invalid_secret", "security.hmac_secret_file", "secret file is too large");
    }
    while (!value.empty() && (value.back() == '\n' || value.back() == '\r')) {
        value.pop_back();
    }
    return value;
}

[[nodiscard]] SecretValue load_secret(const ParsedConfiguration& config,
                                      const IEnvironment& environment) {
    auto direct = environment.get("COLLECTOR_HMAC_SECRET");
    const auto environment_file = environment.get("COLLECTOR_HMAC_SECRET_FILE");
    if (direct.has_value() && environment_file.has_value()) {
        fail("ambiguous_secret_source", "COLLECTOR_HMAC_SECRET",
             "set either COLLECTOR_HMAC_SECRET or COLLECTOR_HMAC_SECRET_FILE, not both");
    }

    std::string encoded;
    if (direct.has_value()) {
        encoded = *direct;
    } else if (environment_file.has_value()) {
        encoded = read_secret_file(resolve_environment_path(*environment_file));
    } else if (config.security.secret_file.has_value()) {
        encoded = read_secret_file(*config.security.secret_file);
    } else {
        fail("missing_secret", "COLLECTOR_HMAC_SECRET",
             "provide COLLECTOR_HMAC_SECRET or a protected secret file");
    }

    try {
        SecretValue secret{encoded};
        clear_string(encoded);
        if (direct.has_value()) {
            clear_string(*direct);
        }
        return secret;
    } catch (const std::invalid_argument& exception) {
        clear_string(encoded);
        if (direct.has_value()) {
            clear_string(*direct);
        }
        fail("invalid_secret", "COLLECTOR_HMAC_SECRET", exception.what());
    }
}

void validate_configuration(const ParsedConfiguration& config) {
    if (!valid_identifier(config.collector.id, true)) {
        fail("invalid_collector_id", "collector.id",
             "must be 1-64 lowercase characters from [a-z0-9._-]");
    }
    if (config.collector.configuration_version.empty() ||
        config.collector.configuration_version.size() > 64U) {
        fail("invalid_configuration_version", "collector.configuration_version",
             "must contain 1-64 characters");
    }
    if (!valid_identifier(config.security.key_id, false)) {
        fail("invalid_key_id", "security.key_id",
             "must be 1-64 characters from [A-Za-z0-9._-]");
    }
    validate_directory(config.output.directory, "output.directory");
    validate_directory(config.output.state_directory, "output.state_directory");
    validate_directory(config.output.outbox_directory, "output.outbox_directory");
    validate_directory(config.output.rejected_directory, "output.rejected_directory");
    validate_distinct_directories(config.output);

    if (config.output.heartbeat_interval != ContractProfile::heartbeat_interval) {
        fail("invalid_heartbeat_interval", "output.heartbeat_interval_seconds",
             "ARCH-01 requires a 30-second heartbeat interval");
    }
    if (config.scheduler.batch_size == 0U ||
        config.scheduler.batch_size > ContractProfile::maximum_events_per_batch) {
        fail("invalid_batch_size", "scheduler.batch_size", "must be between 1 and 1000");
    }
    if (config.scheduler.batch_timeout.count() <= 0 ||
        config.scheduler.batch_timeout > ContractProfile::maximum_batch_dwell_time) {
        fail("invalid_batch_timeout", "scheduler.batch_timeout_seconds",
             "must be between 1 and 5 seconds");
    }
    if (config.scheduler.queue_capacity_events < config.scheduler.batch_size * 2U) {
        fail("invalid_queue_capacity", "scheduler.queue_capacity",
             "must be at least twice scheduler.batch_size");
    }
    if (config.scheduler.queue_capacity_bytes <
        ContractProfile::maximum_encoded_batch_bytes * 2ULL) {
        fail("invalid_queue_byte_capacity", "scheduler.queue_capacity_bytes",
             "must hold at least two maximum-size batches");
    }
    if (config.outbox.maximum_bytes < ContractProfile::maximum_encoded_batch_bytes ||
        config.outbox.maximum_bytes > ContractProfile::maximum_outbox_bytes) {
        fail("invalid_outbox_capacity", "outbox.maximum_bytes",
             "must be between 8 MiB and 10 GiB");
    }
    if (config.outbox.maximum_batches == 0U ||
        config.outbox.maximum_batches > ContractProfile::maximum_outbox_batches) {
        fail("invalid_outbox_batch_capacity", "outbox.maximum_batches",
             "must be between 1 and 10000");
    }
    if (config.outbox.warning_percent == 0U || config.outbox.critical_percent > 100U ||
        config.outbox.warning_percent >= config.outbox.critical_percent) {
        fail("invalid_outbox_thresholds", "outbox",
             "warning_percent must be positive and less than critical_percent <= 100");
    }
    if (config.ocsf.schema_version != ContractProfile::ocsf_schema_version) {
        fail("unsupported_ocsf_version", "ocsf.schema_version", "must be 1.1.0");
    }
    if (config.ocsf.unknown_field_policy != UnknownFieldPolicy::unmapped) {
        fail("unsafe_unknown_field_policy", "ocsf.unknown_field_policy",
             "source fields must be preserved under unmapped");
    }

    std::set<std::string> source_ids;
    std::size_t enabled_count = 0U;
    for (const auto& source : config.sources) {
        if (!valid_identifier(source.id, true)) {
            fail("invalid_source_id", "sources[].id",
                 "must be 1-64 lowercase characters from [a-z0-9._-]");
        }
        if (!source_ids.insert(source.id).second) {
            fail("duplicate_source_id", "sources[].id", "source IDs must be unique");
        }
        if (!source.enabled) {
            continue;
        }
        ++enabled_count;
        if (source.type != SourceType::file_drop) {
            fail("unsupported_enabled_source", "sources[].type",
                 "COL-01C enables only the central file_drop adapter; others remain future work");
        }
        if (source.path.empty()) {
            fail("missing_source_path", "sources[].path", "enabled file_drop requires a path");
        }
    }
    if (enabled_count == 0U) {
        fail("no_enabled_sources", "sources", "at least one central ingress source is required");
    }
}

[[nodiscard]] ParsedConfiguration parse_yaml(const YAML::Node& root,
                                             const std::filesystem::path& config_path) {
    require_keys(root, "$",
                 {"collector", "output", "scheduler", "outbox", "sources", "ocsf",
                  "security"});

    ParsedConfiguration result;
    const auto collector = root["collector"];
    require_keys(collector, "collector",
                 {"id", "configuration_version", "log_level", "log_format", "log_file",
                  "log_max_size_mb", "log_max_files"});
    result.collector.id = scalar_string(collector["id"], "collector.id");
    result.collector.configuration_version =
        scalar_string(collector["configuration_version"], "collector.configuration_version");
    result.collector.log_level =
        parse_log_level(scalar_string(collector["log_level"], "collector.log_level"),
                        "collector.log_level");
    result.collector.log_format =
        parse_log_format(scalar_string(collector["log_format"], "collector.log_format"),
                         "collector.log_format");
    result.collector.log_file =
        required_yaml_path(config_path, collector["log_file"], "collector.log_file");
    result.collector.log_max_size_mb = checked_integer<std::uint32_t>(
        scalar_unsigned(collector["log_max_size_mb"], "collector.log_max_size_mb"), 1U, 1024U,
        "collector.log_max_size_mb");
    result.collector.log_max_files = checked_integer<std::uint32_t>(
        scalar_unsigned(collector["log_max_files"], "collector.log_max_files"), 1U, 100U,
        "collector.log_max_files");

    const auto output = root["output"];
    require_keys(output, "output",
                 {"directory", "state_directory", "outbox_directory", "rejected_directory",
                  "checkpoint_file", "heartbeat_interval_seconds"});
    result.output.directory =
        required_yaml_path(config_path, output["directory"], "output.directory");
    result.output.state_directory = required_yaml_path(
        config_path, output["state_directory"], "output.state_directory");
    result.output.outbox_directory = required_yaml_path(
        config_path, output["outbox_directory"], "output.outbox_directory");
    result.output.rejected_directory = required_yaml_path(
        config_path, output["rejected_directory"], "output.rejected_directory");
    result.output.checkpoint_file = required_yaml_path(
        config_path, output["checkpoint_file"], "output.checkpoint_file");
    result.output.heartbeat_interval = std::chrono::seconds{checked_integer<std::int64_t>(
        scalar_unsigned(output["heartbeat_interval_seconds"],
                        "output.heartbeat_interval_seconds"),
        1U, 300U, "output.heartbeat_interval_seconds")};

    const auto scheduler = root["scheduler"];
    require_keys(scheduler, "scheduler",
                 {"poll_interval_ms", "batch_size", "batch_timeout_seconds", "queue_capacity",
                  "queue_capacity_bytes"});
    result.scheduler.poll_interval = std::chrono::milliseconds{checked_integer<std::int64_t>(
        scalar_unsigned(scheduler["poll_interval_ms"], "scheduler.poll_interval_ms"), 10U,
        60'000U, "scheduler.poll_interval_ms")};
    result.scheduler.batch_size = checked_integer<std::size_t>(
        scalar_unsigned(scheduler["batch_size"], "scheduler.batch_size"), 1U,
        ContractProfile::maximum_events_per_batch, "scheduler.batch_size");
    result.scheduler.batch_timeout = std::chrono::seconds{checked_integer<std::int64_t>(
        scalar_unsigned(scheduler["batch_timeout_seconds"],
                        "scheduler.batch_timeout_seconds"),
        1U, static_cast<std::uint64_t>(ContractProfile::maximum_batch_dwell_time.count()),
        "scheduler.batch_timeout_seconds")};
    result.scheduler.queue_capacity_events = checked_integer<std::size_t>(
        scalar_unsigned(scheduler["queue_capacity"], "scheduler.queue_capacity"), 1U, 1'000'000U,
        "scheduler.queue_capacity");
    result.scheduler.queue_capacity_bytes = checked_integer<std::uint64_t>(
        scalar_unsigned(scheduler["queue_capacity_bytes"], "scheduler.queue_capacity_bytes"), 1U,
        1024ULL * 1024ULL * 1024ULL, "scheduler.queue_capacity_bytes");

    const auto outbox = root["outbox"];
    require_keys(outbox, "outbox",
                 {"maximum_bytes", "maximum_batches", "warning_percent", "critical_percent"});
    result.outbox.maximum_bytes = checked_integer<std::uint64_t>(
        scalar_unsigned(outbox["maximum_bytes"], "outbox.maximum_bytes"), 1U,
        ContractProfile::maximum_outbox_bytes, "outbox.maximum_bytes");
    result.outbox.maximum_batches = checked_integer<std::size_t>(
        scalar_unsigned(outbox["maximum_batches"], "outbox.maximum_batches"), 1U,
        ContractProfile::maximum_outbox_batches, "outbox.maximum_batches");
    result.outbox.warning_percent = checked_integer<std::uint32_t>(
        scalar_unsigned(outbox["warning_percent"], "outbox.warning_percent"), 1U, 100U,
        "outbox.warning_percent");
    result.outbox.critical_percent = checked_integer<std::uint32_t>(
        scalar_unsigned(outbox["critical_percent"], "outbox.critical_percent"), 1U, 100U,
        "outbox.critical_percent");

    const auto sources = root["sources"];
    require_sequence(sources, "sources");
    for (std::size_t index = 0; index < sources.size(); ++index) {
        const auto source = sources[index];
        const auto path = "sources[" + std::to_string(index) + "]";
        require_keys(source, path, {"id", "type", "enabled", "path", "start_position"});
        result.sources.push_back(SourceSettings{
            scalar_string(source["id"], path + ".id"),
            parse_source_type(scalar_string(source["type"], path + ".type"), path + ".type"),
            scalar_bool(source["enabled"], path + ".enabled"),
            required_yaml_path(config_path, source["path"], path + ".path"),
            parse_start_position(scalar_string(source["start_position"], path + ".start_position"),
                                 path + ".start_position")});
    }

    const auto ocsf = root["ocsf"];
    require_keys(ocsf, "ocsf",
                 {"schema_version", "unknown_field_policy", "custom_mappings_dir"});
    result.ocsf.schema_version = scalar_string(ocsf["schema_version"], "ocsf.schema_version");
    result.ocsf.unknown_field_policy = parse_unknown_policy(
        scalar_string(ocsf["unknown_field_policy"], "ocsf.unknown_field_policy"),
        "ocsf.unknown_field_policy");
    result.ocsf.custom_mappings_directory = required_yaml_path(
        config_path, ocsf["custom_mappings_dir"], "ocsf.custom_mappings_dir");

    const auto security = root["security"];
    require_keys(security, "security", {"key_id"}, {"hmac_secret_file"});
    result.security.key_id = scalar_string(security["key_id"], "security.key_id");
    if (security["hmac_secret_file"]) {
        const auto value = scalar_string(security["hmac_secret_file"],
                                         "security.hmac_secret_file");
        if (!value.empty()) {
            result.security.secret_file = resolve_yaml_path(config_path, value);
        }
    }
    return result;
}

} // namespace

ConfigurationError::ConfigurationError(std::string code, std::string path, std::string message)
    : std::runtime_error{code + " at " + path + ": " + message}, code_{std::move(code)},
      path_{std::move(path)} {}

std::optional<std::string> ProcessEnvironment::get(const std::string_view name) const {
    const std::string key{name};

#ifdef _WIN32
    char* value = nullptr;
    std::size_t size = 0;

    if (_dupenv_s(&value, &size, key.c_str()) != 0 || value == nullptr) {
        std::free(value);
        return std::nullopt;
    }

    std::string result{value};
    std::free(value);
    return result;
#else
    const auto* value = std::getenv(key.c_str());

    if (value == nullptr) {
        return std::nullopt;
    }

    return std::string{value};
#endif
}

CollectorConfig ConfigLoader::load(const std::filesystem::path& path) {
    const ProcessEnvironment environment;
    return load(path, environment);
}

CollectorConfig ConfigLoader::load(const std::filesystem::path& path,
                                   const IEnvironment& environment) {
    std::error_code error;
    if (!std::filesystem::exists(path, error) || error ||
        !std::filesystem::is_regular_file(path, error) || error) {
        fail("config_not_found", "$", "configuration file not found: " + path.string());
    }
    const auto size = std::filesystem::file_size(path, error);
    if (error || size > 1024U * 1024U) {
        fail("config_too_large", "$", "configuration file must not exceed 1 MiB");
    }

    YAML::Node root;
    try {
        root = YAML::LoadFile(path.string());
    } catch (const YAML::Exception& exception) {
        fail("invalid_yaml", "$", exception.what());
    }

    auto parsed = parse_yaml(root, std::filesystem::absolute(path).lexically_normal());
    validate_configuration(parsed);
    apply_environment(parsed, environment);
    validate_configuration(parsed);
    auto secret = load_secret(parsed, environment);

    return CollectorConfig{std::move(parsed.collector), std::move(parsed.output),
                           std::move(parsed.scheduler), std::move(parsed.outbox),
                           std::move(parsed.sources), std::move(parsed.ocsf),
                           SecuritySettings{std::move(parsed.security.key_id), std::move(secret)}};
}

} // namespace trivikrama::collector::config
