#include "trivikrama/collector/runtime/identifier_generator.hpp"

#include <gtest/gtest.h>

#include <regex>
#include <set>
#include <string>

namespace trivikrama::collector::runtime {
namespace {

TEST(RandomIdentifierGenerator, ProducesRfc4122VersionFourIdentifiers) {
    RandomIdentifierGenerator generator;
    const std::regex expected{
        "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"};
    EXPECT_TRUE(std::regex_match(generator.next_uuid_v4(), expected));
}

TEST(RandomIdentifierGenerator, DoesNotRepeatAcrossSample) {
    RandomIdentifierGenerator generator;
    std::set<std::string> identifiers;
    for (std::size_t index = 0U; index < 1000U; ++index) {
        identifiers.insert(generator.next_uuid_v4());
    }
    EXPECT_EQ(identifiers.size(), 1000U);
}

} // namespace
} // namespace trivikrama::collector::runtime
