#include "trivikrama/collector/monitoring/resource_probe.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <thread>
#include <utility>

#ifdef _WIN32
#define NOMINMAX
#include <Windows.h>
#include <Psapi.h>
#elif defined(__linux__)
#include <unistd.h>
#endif

namespace trivikrama::collector::monitoring {
namespace {

struct MemorySample final {
    std::uint64_t bytes{};
    bool available{};
};

[[nodiscard]] MemorySample process_memory() {
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS counters{};
    counters.cb = static_cast<DWORD>(sizeof(counters));
    if (::GetProcessMemoryInfo(::GetCurrentProcess(), &counters,
                               static_cast<DWORD>(sizeof(counters))) == 0) {
        return {};
    }
    return {static_cast<std::uint64_t>(counters.WorkingSetSize), true};
#elif defined(__linux__)
    std::ifstream input{"/proc/self/statm"};
    std::uint64_t total_pages{};
    std::uint64_t resident_pages{};
    if (!(input >> total_pages >> resident_pages)) {
        return {};
    }
    static_cast<void>(total_pages);
    const auto page_size = ::sysconf(_SC_PAGESIZE);
    if (page_size <= 0) {
        return {};
    }
    const auto unsigned_page_size = static_cast<std::uint64_t>(page_size);
    if (resident_pages > std::numeric_limits<std::uint64_t>::max() / unsigned_page_size) {
        return {};
    }
    return {resident_pages * unsigned_page_size, true};
#else
    return {};
#endif
}

} // namespace

SystemResourceProbe::SystemResourceProbe(std::filesystem::path monitored_path)
    : monitored_path_{std::move(monitored_path)} {
    if (monitored_path_.empty()) {
        throw std::invalid_argument{"resource probe path must not be empty"};
    }
}

ResourceMetrics SystemResourceProbe::sample() {
    std::lock_guard lock{mutex_};
    ResourceMetrics result;
    bool cpu_available = true;
    const auto current_cpu = std::clock();
    const auto current_wall = std::chrono::steady_clock::now();
    if (current_cpu == static_cast<std::clock_t>(-1)) {
        cpu_available = false;
    } else if (has_previous_cpu_sample_) {
        const auto cpu_seconds = static_cast<double>(current_cpu - previous_cpu_) /
                                 static_cast<double>(CLOCKS_PER_SEC);
        const auto wall_seconds =
            std::chrono::duration<double>{current_wall - previous_wall_}.count();
        const auto processors = std::max(1U, std::thread::hardware_concurrency());
        if (cpu_seconds < 0.0 || wall_seconds <= 0.0) {
            cpu_available = false;
        } else {
            result.cpu_percent =
                std::clamp((cpu_seconds / wall_seconds) * 100.0 /
                               static_cast<double>(processors),
                           0.0, 100.0);
        }
    }
    if (current_cpu != static_cast<std::clock_t>(-1)) {
        previous_cpu_ = current_cpu;
        previous_wall_ = current_wall;
        has_previous_cpu_sample_ = true;
    }

    const auto memory = process_memory();
    result.memory_bytes = memory.bytes;
    std::error_code error;
    const auto space = std::filesystem::space(monitored_path_, error);
    if (!error) {
        result.disk_available_bytes = space.available;
    }
    result.complete = cpu_available && memory.available && !error;
    return result;
}

} // namespace trivikrama::collector::monitoring
