#pragma once

#include <string_view>

namespace trivikrama::collector {

struct BuildInfo final {
    static constexpr std::string_view name{"trivikrama-collector"};
    static constexpr std::string_view version{"0.8.0"};
    static constexpr std::string_view language_standard{"C++20"};
};

} // namespace trivikrama::collector
