#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/security/canonical_json.hpp"

#include <gtest/gtest.h>

#include <limits>
#include <string>

namespace trivikrama::collector::security {
namespace {

TEST(CanonicalJson, OrdersObjectPropertiesByUtf16CodeUnits) {
    contract::Json document = contract::Json::object();
    document["\xEF\xAC\xB3"] = 7; // U+FB33
    document["\xF0\x9F\x98\x80"] = 6; // U+1F600, UTF-16 D83D DE00
    document["\xE2\x82\xAC"] = 5; // U+20AC
    document["\xC3\xB6"] = 4; // U+00F6
    document["\xC2\x80"] = 3; // U+0080
    document["1"] = 2;
    document["\r"] = 1;

    EXPECT_EQ(canonicalize(document),
              "{\"\\r\":1,\"1\":2,\"\xC2\x80\":3,\"\xC3\xB6\":4,"
              "\"\xE2\x82\xAC\":5,\"\xF0\x9F\x98\x80\":6,\"\xEF\xAC\xB3\":7}");
}

TEST(CanonicalJson, UsesEcmascriptNumberFormattingBoundaries) {
    const contract::Json document = contract::Json::array(
        {333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0.0, 1e-6, 1e-7, 1e20,
         1e21});

    EXPECT_EQ(canonicalize(document),
              "[333333333.3333333,1e+30,4.5,0.002,1e-27,0,0.000001,1e-7,"
              "100000000000000000000,1e+21]");
}

TEST(CanonicalJson, AppliesMinimalStringEscaping) {
    const contract::Json document{{"text", "€$\x0f\nA'B\"\\\"/"}};
    EXPECT_EQ(canonicalize(document), "{\"text\":\"€$\\u000f\\nA'B\\\"\\\\\\\"/\"}");
}

TEST(CanonicalJson, RejectsValuesOutsideTheJsonDataModel) {
    EXPECT_THROW(static_cast<void>(
                     canonicalize(contract::Json{std::numeric_limits<double>::infinity()})),
                 CanonicalizationError);
    EXPECT_THROW(static_cast<void>(canonicalize(contract::Json::binary({1U, 2U}))),
                 CanonicalizationError);
}

} // namespace
} // namespace trivikrama::collector::security
