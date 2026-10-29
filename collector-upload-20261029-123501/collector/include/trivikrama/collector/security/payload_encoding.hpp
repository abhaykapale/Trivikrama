#pragma once

#include <memory>
#include <string>
#include <string_view>

namespace trivikrama::collector::security {

class Sha256Accumulator final {
  public:
    Sha256Accumulator();
    ~Sha256Accumulator();

    Sha256Accumulator(const Sha256Accumulator&) = delete;
    Sha256Accumulator& operator=(const Sha256Accumulator&) = delete;
    Sha256Accumulator(Sha256Accumulator&&) noexcept;
    Sha256Accumulator& operator=(Sha256Accumulator&&) noexcept;

    void reset();
    void update(std::string_view value);
    [[nodiscard]] std::string finish_hex();

  private:
    struct Implementation;
    std::unique_ptr<Implementation> implementation_;
};

[[nodiscard]] std::string sha256_hex(std::string_view value);
[[nodiscard]] std::string base64_encode(std::string_view value);

} // namespace trivikrama::collector::security
