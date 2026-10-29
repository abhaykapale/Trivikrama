#include "trivikrama/collector/build_info.hpp"
#include "trivikrama/collector/config/config_loader.hpp"
#include "trivikrama/collector/ingress/file_reader.hpp"
#include "trivikrama/collector/monitoring/resource_probe.hpp"
#include "trivikrama/collector/runtime/collector_runtime.hpp"
#include "trivikrama/collector/runtime/identifier_generator.hpp"

#include <algorithm>
#include <chrono>
#include <csignal>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>

namespace {

constexpr int success_exit_code = 0;
constexpr int invalid_usage_exit_code = 64;
constexpr int invalid_configuration_exit_code = 78;
constexpr int runtime_failure_exit_code = 70;

volatile std::sig_atomic_t stop_requested = 0;

extern "C" void request_stop(const int signal_number) {
    stop_requested = signal_number;
}

void print_usage(const std::string_view program_name) {
    std::cout << "Usage: " << program_name
              << " [--version|--help|--check-config <config.yaml>|--config <config.yaml>]\n"
              << "With no arguments, config/collector.yaml is used.\n";
}

int run_collector(const std::filesystem::path& config_path) {
    auto configuration =
        trivikrama::collector::config::ConfigLoader::load(config_path);
    trivikrama::collector::ingress::SystemUtcClock clock;
    trivikrama::collector::runtime::RandomIdentifierGenerator identifiers;
    trivikrama::collector::monitoring::SystemResourceProbe resources{
        configuration.output.directory};
    trivikrama::collector::runtime::CollectorRuntime runtime{
        configuration, clock, identifiers, resources};

    stop_requested = 0;
    static_cast<void>(std::signal(SIGINT, request_stop));
    static_cast<void>(std::signal(SIGTERM, request_stop));
    runtime.start(std::chrono::steady_clock::now());
    std::cout << trivikrama::collector::BuildInfo::name << " "
              << trivikrama::collector::BuildInfo::version
              << " started with collector_id=" << configuration.collector.id << '\n';
    while (stop_requested == 0) {
        const auto cycle_started = std::chrono::steady_clock::now();
        runtime.poll_once(cycle_started);
        std::this_thread::sleep_until(cycle_started +
                                      configuration.scheduler.poll_interval);
    }
    runtime.shutdown(std::chrono::steady_clock::now());
    std::cout << "Collector shutdown completed after signal " << stop_requested << ".\n";
    return success_exit_code;
}

} // namespace

int main(const int argc, const char* const argv[]) {
    using trivikrama::collector::BuildInfo;

    if (argc == 1) {
        try {
            return run_collector("config/collector.yaml");
        } catch (const trivikrama::collector::config::ConfigurationError& error) {
            std::cerr << "Configuration invalid: " << error.what() << '\n';
            return invalid_configuration_exit_code;
        } catch (const std::exception& error) {
            std::cerr << "Collector runtime failed: " << error.what() << '\n';
            return runtime_failure_exit_code;
        }
    }

    const std::string_view argument{argv[1]};
    if (argument == "--version" && argc == 2) {
        std::cout << BuildInfo::name << " " << BuildInfo::version << " ("
                  << BuildInfo::language_standard << ")\n";
        return success_exit_code;
    }
    if (argument == "--help" && argc == 2) {
        print_usage(argv[0]);
        return success_exit_code;
    }
    if (argument == "--check-config" && argc == 3) {
        try {
            const auto configuration =
                trivikrama::collector::config::ConfigLoader::load(argv[2]);
            std::cout << "Configuration valid: collector_id=" << configuration.collector.id
                      << ", configuration_version="
                      << configuration.collector.configuration_version
                      << ", enabled_sources="
                      << std::count_if(configuration.sources.begin(), configuration.sources.end(),
                                       [](const auto& source) { return source.enabled; })
                      << ", hmac_secret=" << configuration.security.hmac_secret.redacted() << '\n';
            return success_exit_code;
        } catch (const trivikrama::collector::config::ConfigurationError& error) {
            std::cerr << "Configuration invalid: " << error.what() << '\n';
            return invalid_configuration_exit_code;
        } catch (const std::exception& error) {
            std::cerr << "Configuration validation failed: " << error.what() << '\n';
            return invalid_configuration_exit_code;
        }
    }
    if (argument == "--config" && argc == 3) {
        try {
            return run_collector(argv[2]);
        } catch (const trivikrama::collector::config::ConfigurationError& error) {
            std::cerr << "Configuration invalid: " << error.what() << '\n';
            return invalid_configuration_exit_code;
        } catch (const std::exception& error) {
            std::cerr << "Collector runtime failed: " << error.what() << '\n';
            return runtime_failure_exit_code;
        }
    }

    std::cerr << "Unknown argument: " << argument << '\n';
    print_usage(argv[0]);
    return invalid_usage_exit_code;
}
