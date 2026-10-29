#include "trivikrama/collector/security/payload_encoding.hpp"

#include <gtest/gtest.h>

namespace trivikrama::collector::security {
namespace {

TEST(PayloadEncoding, ProducesKnownSha256Vector) {
    EXPECT_EQ(sha256_hex("abc"),
              "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST(PayloadEncoding, SupportsIncrementalSha256) {
    Sha256Accumulator digest;
    digest.update("a");
    digest.update("bc");
    EXPECT_EQ(digest.finish_hex(), sha256_hex("abc"));
}

TEST(PayloadEncoding, ProducesCanonicalPaddedBase64) {
    EXPECT_EQ(base64_encode(""), "");
    EXPECT_EQ(base64_encode("f"), "Zg==");
    EXPECT_EQ(base64_encode("fo"), "Zm8=");
    EXPECT_EQ(base64_encode("foo"), "Zm9v");
}

} // namespace
} // namespace trivikrama::collector::security
