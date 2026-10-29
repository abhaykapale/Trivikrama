#pragma once

#include "trivikrama/collector/monitoring/operational_metrics.hpp"

#include <chrono>
#include <ctime>
#include <filesystem>
#include <mutex>

namespace trivikrama::collector::monitoring {

class IResourceProbe {
  public:
    virtual ~IResourceProbe() = default;
    [[nodiscard]] virtual ResourceMetrics sample() = 0;
};

class SystemResourceProbe final : public IResourceProbe {
  public:
    explicit SystemResourceProbe(std::filesystem::path monitored_path);

    [[nodiscard]] ResourceMetrics sample() override;

  private:
    std::filesystem::path monitored_path_;
    std::mutex mutex_;
    bool has_previous_cpu_sample_{};
    std::clock_t previous_cpu_{};
    std::chrono::steady_clock::time_point previous_wall_{};
};

} // namespace trivikrama::collector::monitoring
