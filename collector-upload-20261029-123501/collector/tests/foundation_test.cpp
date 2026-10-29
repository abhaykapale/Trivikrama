#include "trivikrama/collector/build_info.hpp"

#include <gtest/gtest.h>

namespace trivikrama::collector {

TEST(Foundation, DeclaresExpectedBuildIdentity) {
    EXPECT_EQ(BuildInfo::name, "trivikrama-collector");
    EXPECT_EQ(BuildInfo::version, "0.8.0");
    EXPECT_EQ(BuildInfo::language_standard, "C++20");
}

} // namespace trivikrama::collector
