#pragma once

#include <array>
#include <cstdint>
#include <mutex>
#include <string>

namespace trivikrama::collector::runtime {

class IIdentifierGenerator {
  public:
    virtual ~IIdentifierGenerator() = default;
    [[nodiscard]] virtual std::string next_uuid_v4() = 0;
};

class RandomIdentifierGenerator final : public IIdentifierGenerator {
  public:
    RandomIdentifierGenerator() = default;
    [[nodiscard]] std::string next_uuid_v4() override;

  private:
    std::mutex mutex_;
};

} // namespace trivikrama::collector::runtime
