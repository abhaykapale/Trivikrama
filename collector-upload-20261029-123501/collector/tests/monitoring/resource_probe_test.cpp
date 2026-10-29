#include "trivikrama/collector/monitoring/resource_probe.hpp"

#include <gtest/gtest.h>

#include <filesystem>

namespace trivikrama::collector::monitoring {
namespace {

TEST(SystemResourceProbe, SamplesCurrentProcessAndMonitoredFilesystem) {
    SystemResourceProbe probe{std::filesystem::temp_directory_path()};

    const auto first = probe.sample();
    const auto second = probe.sample();

    EXPECT_TRUE(first.complete);
    EXPECT_TRUE(first.memory_bytes > 0U);
    EXPECT_TRUE(first.disk_available_bytes > 0U);
    EXPECT_TRUE(second.cpu_percent >= 0.0);
    EXPECT_TRUE(second.cpu_percent <= 100.0);
}

TEST(SystemResourceProbe, RejectsAnEmptyMonitoredPath) {
    EXPECT_THROW(SystemResourceProbe(std::filesystem::path{}), std::invalid_argument);
}

} // namespace
} // namespace trivikrama::collector::monitoring
