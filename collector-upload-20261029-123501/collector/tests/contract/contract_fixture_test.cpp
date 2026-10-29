#include "trivikrama/collector/contract/contract_profile.hpp"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::contract {
namespace {

using Json = nlohmann::json;

[[nodiscard]] Json load_fixture(const std::string& filename) {
    const auto path = std::filesystem::path{COLLECTOR_CONTRACT_FIXTURE_DIR} / filename;
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        throw std::runtime_error{"Unable to open contract fixture: " + path.string()};
    }

    return Json::parse(input, nullptr, true, true);
}

} // namespace

TEST(ContractFixture, UnsignedBatchPreservesIntegrityMetadataButOmitsValue) {
    const auto document = load_fixture("unsigned-batch.json");

    EXPECT_EQ(document.at("contract_version").get<std::string>(),
              std::string{ContractProfile::contract_version});
    EXPECT_EQ(document.at("message_type").get<std::string>(),
              std::string{ContractProfile::event_batch_message_type});
    EXPECT_EQ(document.at("ocsf_schema_version").get<std::string>(),
              std::string{ContractProfile::ocsf_schema_version});
    EXPECT_EQ(document.at("event_count"), document.at("events").size());
    ASSERT_TRUE(document.contains("integrity"));
    EXPECT_EQ(document.at("integrity").at("algorithm").get<std::string>(),
              std::string{ContractProfile::signature_algorithm});
    EXPECT_TRUE(document.at("integrity").contains("key_id"));
    EXPECT_FALSE(document.at("integrity").contains("value"));
}

TEST(ContractFixture, EventPreservesSourceAndOriginalPayload) {
    const auto document = load_fixture("unsigned-batch.json");
    const auto& event = document.at("events").at(0);

    EXPECT_TRUE(event.contains("event_id"));
    EXPECT_TRUE(event.contains("source"));
    EXPECT_TRUE(event.at("source").contains("original_endpoint_id"));
    EXPECT_TRUE(event.at("source").contains("upstream_event_id"));
    EXPECT_TRUE(event.at("source").contains("upstream_sender_id"));
    EXPECT_TRUE(event.at("source").contains("position"));
    EXPECT_TRUE(event.contains("event_time"));
    EXPECT_TRUE(event.contains("received_time"));
    EXPECT_TRUE(event.contains("raw_payload"));
    EXPECT_TRUE(event.contains("ocsf"));
}

TEST(ContractFixture, ContractManifestDocumentsCompatibilityBoundaries) {
    const auto manifest = load_fixture("manifest.json");

    EXPECT_EQ(manifest.at("contract_version").get<std::string>(),
              std::string{ContractProfile::contract_version});
    EXPECT_EQ(manifest.at("canonicalization"), "RFC8785");
    EXPECT_EQ(manifest.at("maximum_json_nesting"), 128);
    EXPECT_EQ(manifest.at("numeric_policy"), "finite-ieee754-safe-range");
    EXPECT_EQ(manifest.at("signature_encoding"), "base64url-unpadded");
    EXPECT_EQ(manifest.at("unsigned_document_rule"), "omit-only-integrity.value");
    EXPECT_EQ(manifest.at("batch_filename"), "batch_<uuid-v4>.json");
    EXPECT_EQ(manifest.at("publication"), "same-filesystem-fsync-then-atomic-rename");
}

} // namespace trivikrama::collector::contract
