#pragma once

#include "trivikrama/collector/config/config.hpp"

#include <filesystem>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::config {

class ConfigurationError final : public std::runtime_error {
  public:
    ConfigurationError(std::string code, std::string path, std::string message);

    [[nodiscard]] const std::string& code() const noexcept { return code_; }
    [[nodiscard]] const std::string& path() const noexcept { return path_; }

  private:
    std::string code_;
    std::string path_;
};

class IEnvironment {
  public:
    virtual ~IEnvironment() = default;
    [[nodiscard]] virtual std::optional<std::string> get(std::string_view name) const = 0;
};

class ProcessEnvironment final : public IEnvironment {
  public:
    [[nodiscard]] std::optional<std::string> get(std::string_view name) const override;
};

class ConfigLoader final {
  public:
    [[nodiscard]] static CollectorConfig load(const std::filesystem::path& path);
    [[nodiscard]] static CollectorConfig load(const std::filesystem::path& path,
                                              const IEnvironment& environment);
};

} // namespace trivikrama::collector::config

