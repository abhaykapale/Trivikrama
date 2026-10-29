#include "trivikrama/collector/config/config_loader.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

#ifndef _WIN32
#include <sys/stat.h>
#endif

namespace trivikrama::collector::config {
namespace {

constexpr std::string_view valid_secret =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";

class MapEnvironment final : public IEnvironment {
  public:
    explicit MapEnvironment(std::map<std::string, std::string> values = {})
        : values_{std::move(values)} {}

    [[nodiscard]] std::optional<std::string> get(const std::string_view name) const override {
        const auto match = values_.find(std::string{name});
        if (match == values_.end()) {
            return std::nullopt;
        }
        return match->second;
    }

  private:
    std::map<std::string, std::string> values_;
};

[[nodiscard]] std::string read_text(const std::filesystem::path& path) {
    std::ifstream input{path};
    if (!input) {
        throw std::runtime_error{"cannot read test fixture"};
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_text(const std::filesystem::path& path, const std::string_view value) {
    std::ofstream output{path, std::ios::binary | std::ios::trunc};
    if (!output) {
        throw std::runtime_error{"cannot write test fixture"};
    }
    output << value;
}

[[nodiscard]] std::string replace_once(std::string value, const std::string_view before,
                                       const std::string_view after) {
    const auto position = value.find(before);
    if (position == std::string::npos) {
        throw std::runtime_error{"test fixture token not found"};
    }
    value.replace(position, before.size(), after);
    return value;
}

class ConfigWorkspace final {
  public:
    ConfigWorkspace() {
        static std::atomic<unsigned long long> sequence{};
        const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
        root_ = std::filesystem::temp_directory_path() /
                ("trivikrama-config-test-" + std::to_string(stamp) + "-" +
                 std::to_string(sequence.fetch_add(1U)));
        std::filesystem::create_directories(root_ / "runtime/handoff");
        std::filesystem::create_directories(root_ / "runtime/state");
        std::filesystem::create_directories(root_ / "runtime/outbox");
        std::filesystem::create_directories(root_ / "runtime/rejected");
        std::filesystem::create_directories(root_ / "runtime/logs");
        std::filesystem::create_directories(root_ / "mappings");
        std::filesystem::create_directories(root_ / "samples");
        yaml_ = read_text(std::filesystem::path{COLLECTOR_CONFIG_FIXTURE_DIR} / "valid.yaml");
        save();
    }

    ~ConfigWorkspace() {
        std::error_code ignored;
        std::filesystem::remove_all(root_, ignored);
    }

    ConfigWorkspace(const ConfigWorkspace&) = delete;
    ConfigWorkspace& operator=(const ConfigWorkspace&) = delete;

    [[nodiscard]] const std::filesystem::path& config_path() const noexcept {
        return config_path_;
    }

    [[nodiscard]] const std::filesystem::path& root() const noexcept { return root_; }

    void replace(const std::string_view before, const std::string_view after) {
        yaml_ = replace_once(std::move(yaml_), before, after);
        save();
    }

    [[nodiscard]] std::filesystem::path write_secret(const std::string_view contents) const {
        const auto path = root_ / "hmac.secret";
        write_text(path, contents);
#ifndef _WIN32
        if (::chmod(path.c_str(), S_IRUSR | S_IWUSR) != 0) {
            throw std::runtime_error{"cannot protect test secret"};
        }
#endif
        return path;
    }

  private:
    void save() {
        config_path_ = root_ / "collector.yaml";
        write_text(config_path_, yaml_);
    }

    std::filesystem::path root_;
    std::filesystem::path config_path_;
    std::string yaml_;
};

[[nodiscard]] MapEnvironment secret_environment() {
    return MapEnvironment{{{"COLLECTOR_HMAC_SECRET", std::string{valid_secret}}}};
}

void expect_error_code(const ConfigWorkspace& workspace, const IEnvironment& environment,
                       const std::string_view expected_code) {
    try {
        static_cast<void>(ConfigLoader::load(workspace.config_path(), environment));
        FAIL() << "expected configuration validation to fail";
    } catch (const ConfigurationError& error) {
        EXPECT_EQ(error.code(), expected_code);
    }
}

TEST(ConfigLoaderTest, LoadsStrictYamlAndResolvesRelativePaths) {
    ConfigWorkspace workspace;

    const auto config = ConfigLoader::load(workspace.config_path(), secret_environment());

    EXPECT_EQ(config.collector.id, "collector-test-01");
    EXPECT_EQ(config.collector.log_level, LogLevel::info);
    EXPECT_EQ(config.output.directory, workspace.root() / "runtime/handoff");
    EXPECT_EQ(config.output.state_directory, workspace.root() / "runtime/state");
    EXPECT_EQ(config.scheduler.batch_size, 1000U);
    EXPECT_EQ(config.sources.size(), 1U);
    EXPECT_EQ(config.sources.front().type, SourceType::file_drop);
    EXPECT_EQ(config.security.hmac_secret.redacted(), "[REDACTED]");
    EXPECT_EQ(config.security.hmac_secret.encoded().size(), SecretValue::encoded_size);
}

TEST(ConfigLoaderTest, AppliesOnlyDocumentedEnvironmentOverrides) {
    ConfigWorkspace workspace;
    const auto alternate_output = workspace.root() / "alternate-handoff";
    std::filesystem::create_directory(alternate_output);
    const MapEnvironment environment{{
        {"COLLECTOR_HMAC_SECRET", std::string{valid_secret}},
        {"COLLECTOR_ID", "collector-env-01"},
        {"COLLECTOR_LOG_LEVEL", "ERROR"},
        {"COLLECTOR_OUTPUT_DIR", alternate_output.string()},
        {"COLLECTOR_BATCH_SIZE", "400"},
        {"COLLECTOR_BATCH_TIMEOUT", "3"},
    }};

    const auto config = ConfigLoader::load(workspace.config_path(), environment);

    EXPECT_EQ(config.collector.id, "collector-env-01");
    EXPECT_EQ(config.collector.log_level, LogLevel::error);
    EXPECT_EQ(config.output.directory, alternate_output);
    EXPECT_EQ(config.scheduler.batch_size, 400U);
    EXPECT_EQ(config.scheduler.batch_timeout, std::chrono::seconds{3});
}

TEST(ConfigLoaderTest, RejectsUnknownYamlFields) {
    ConfigWorkspace workspace;
    workspace.replace("  log_max_files: 5", "  log_max_files: 5\n  surprise: true");
    expect_error_code(workspace, secret_environment(), "unknown_field");
}

TEST(ConfigLoaderTest, RejectsDuplicateYamlFields) {
    ConfigWorkspace workspace;
    workspace.replace("  log_level: \"INFO\"",
                      "  log_level: \"INFO\"\n  log_level: \"DEBUG\"");
    expect_error_code(workspace, secret_environment(), "duplicate_field");
}

TEST(ConfigLoaderTest, RejectsDuplicateSourceIdentifiers) {
    ConfigWorkspace workspace;
    workspace.replace("ocsf:\n", R"(  - id: "simulated_auth_input"
    type: "file_drop"
    enabled: false
    path: "samples/second.jsonl"
    start_position: "oldest"

ocsf:
)");
    expect_error_code(workspace, secret_environment(), "duplicate_source_id");
}

TEST(ConfigLoaderTest, RejectsConfigurationWithoutEnabledSources) {
    ConfigWorkspace workspace;
    workspace.replace("    enabled: true", "    enabled: false");
    expect_error_code(workspace, secret_environment(), "no_enabled_sources");
}

TEST(ConfigLoaderTest, RejectsEmptyPathsAndMissingOutputDirectories) {
    ConfigWorkspace empty_path_workspace;
    empty_path_workspace.replace("    path: \"samples/simulated-auth.jsonl\"",
                                 "    path: \"\"");
    expect_error_code(empty_path_workspace, secret_environment(), "empty_path");

    ConfigWorkspace missing_directory_workspace;
    missing_directory_workspace.replace("  directory: \"runtime/handoff\"",
                                        "  directory: \"runtime/missing\"");
    expect_error_code(missing_directory_workspace, secret_environment(),
                      "invalid_directory");
}

TEST(ConfigLoaderTest, RejectsIngressAdaptersReservedForLaterMilestones) {
    ConfigWorkspace workspace;
    workspace.replace("    type: \"file_drop\"", "    type: \"syslog\"");
    expect_error_code(workspace, secret_environment(), "unsupported_enabled_source");
}

TEST(ConfigLoaderTest, EnforcesQueueAndOutboxCapacityInvariants) {
    ConfigWorkspace queue_workspace;
    queue_workspace.replace("  queue_capacity: 100000", "  queue_capacity: 1000");
    expect_error_code(queue_workspace, secret_environment(), "invalid_queue_capacity");

    ConfigWorkspace bytes_workspace;
    bytes_workspace.replace("  queue_capacity_bytes: 67108864",
                            "  queue_capacity_bytes: 8388608");
    expect_error_code(bytes_workspace, secret_environment(), "invalid_queue_byte_capacity");

    ConfigWorkspace outbox_workspace;
    outbox_workspace.replace("  warning_percent: 80", "  warning_percent: 95");
    expect_error_code(outbox_workspace, secret_environment(), "invalid_outbox_thresholds");
}

TEST(ConfigLoaderTest, EnforcesFrozenContractValues) {
    ConfigWorkspace heartbeat_workspace;
    heartbeat_workspace.replace("  heartbeat_interval_seconds: 30",
                                "  heartbeat_interval_seconds: 60");
    expect_error_code(heartbeat_workspace, secret_environment(),
                      "invalid_heartbeat_interval");

    ConfigWorkspace ocsf_workspace;
    ocsf_workspace.replace("  unknown_field_policy: \"unmapped\"",
                           "  unknown_field_policy: \"drop\"");
    expect_error_code(ocsf_workspace, secret_environment(),
                      "unsafe_unknown_field_policy");
}

TEST(ConfigLoaderTest, RejectsMissingInvalidAndAmbiguousSecretsWithoutDisclosure) {
    ConfigWorkspace workspace;
    expect_error_code(workspace, MapEnvironment{}, "missing_secret");

    const std::string invalid_secret(64U, '!');
    const MapEnvironment invalid{{{"COLLECTOR_HMAC_SECRET", invalid_secret}}};
    try {
        static_cast<void>(ConfigLoader::load(workspace.config_path(), invalid));
        FAIL() << "expected invalid secret to fail";
    } catch (const ConfigurationError& error) {
        EXPECT_EQ(error.code(), "invalid_secret");
        EXPECT_EQ(std::string{error.what()}.find(invalid_secret), std::string::npos);
    }

    const auto secret_file = workspace.write_secret(valid_secret);
    const MapEnvironment ambiguous{{
        {"COLLECTOR_HMAC_SECRET", std::string{valid_secret}},
        {"COLLECTOR_HMAC_SECRET_FILE", secret_file.string()},
    }};
    expect_error_code(workspace, ambiguous, "ambiguous_secret_source");
}

TEST(ConfigLoaderTest, LoadsProtectedSecretFile) {
    ConfigWorkspace workspace;
    const auto secret_file = workspace.write_secret(std::string{valid_secret} + "\r\n");
    const MapEnvironment environment{{{"COLLECTOR_HMAC_SECRET_FILE", secret_file.string()}}};

    const auto config = ConfigLoader::load(workspace.config_path(), environment);

    EXPECT_EQ(config.security.hmac_secret.encoded().size(), SecretValue::encoded_size);
    EXPECT_EQ(config.security.hmac_secret.redacted(), "[REDACTED]");
}

TEST(ConfigLoaderTest, LoadsProtectedYamlSecretFileFallback) {
    ConfigWorkspace workspace;
    static_cast<void>(workspace.write_secret(valid_secret));
    workspace.replace("  key_id: \"collector-test-key-01\"",
                      "  key_id: \"collector-test-key-01\"\n"
                      "  hmac_secret_file: \"hmac.secret\"");

    const auto config = ConfigLoader::load(workspace.config_path(), MapEnvironment{});

    EXPECT_EQ(config.security.hmac_secret.encoded().size(), SecretValue::encoded_size);
}

#ifndef _WIN32
TEST(ConfigLoaderTest, RejectsSecretFilesWithBroadPermissionsOrSymlinks) {
    ConfigWorkspace permissions_workspace;
    const auto broad_secret = permissions_workspace.write_secret(valid_secret);
    ASSERT_EQ(::chmod(broad_secret.c_str(), S_IRUSR | S_IWUSR | S_IRGRP), 0);
    const MapEnvironment broad_environment{
        {{"COLLECTOR_HMAC_SECRET_FILE", broad_secret.string()}}};
    expect_error_code(permissions_workspace, broad_environment,
                      "insecure_secret_permissions");

    ConfigWorkspace symlink_workspace;
    const auto target = symlink_workspace.write_secret(valid_secret);
    const auto link = symlink_workspace.root() / "linked.secret";
    std::filesystem::create_symlink(target, link);
    const MapEnvironment symlink_environment{{{"COLLECTOR_HMAC_SECRET_FILE", link.string()}}};
    expect_error_code(symlink_workspace, symlink_environment, "invalid_secret_file");
}
#endif

TEST(ConfigLoaderTest, RejectsMalformedNumericEnvironmentOverrides) {
    ConfigWorkspace workspace;
    const MapEnvironment environment{{
        {"COLLECTOR_HMAC_SECRET", std::string{valid_secret}},
        {"COLLECTOR_BATCH_SIZE", "1000events"},
    }};
    expect_error_code(workspace, environment, "invalid_environment");
}

} // namespace
} // namespace trivikrama::collector::config
