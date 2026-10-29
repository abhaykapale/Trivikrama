#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/security/canonical_json.hpp"
#include "trivikrama/collector/security/contract_signer.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::security {
namespace {

[[nodiscard]] std::string load_text(const std::filesystem::path& path) {
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        throw std::runtime_error{"cannot open signing fixture: " + path.string()};
    }
    return {std::istreambuf_iterator<char>{input}, std::istreambuf_iterator<char>{}};
}

[[nodiscard]] std::string without_final_newline(std::string value) {
    if (!value.empty() && value.back() == '\n') {
        value.pop_back();
    }
    return value;
}

[[nodiscard]] config::SecretValue test_secret(const char character = 'A') {
    return config::SecretValue{std::string(64U, character)};
}

[[nodiscard]] contract::EventBatch unsigned_batch() {
    return contract::parse_event_batch(
        load_text(std::filesystem::path{COLLECTOR_CONTRACT_FIXTURE_DIR} /
                  "unsigned-batch.json"),
        contract::SignatureRequirement::allow_unsigned);
}

TEST(ContractSigner, MatchesTheSharedCrossLanguageBatchVector) {
    const auto vector = contract::parse_json_strict(load_text(
        std::filesystem::path{COLLECTOR_SIGNING_FIXTURE_DIR} / "vector.json"));
    const config::SecretValue secret{vector.at("secret_base64url").get<std::string>()};
    const ContractSigner signer{vector.at("key_id").get<std::string>(), secret};
    auto batch = unsigned_batch();
    const auto canonical_fixture = without_final_newline(load_text(
        std::filesystem::path{COLLECTOR_SIGNING_FIXTURE_DIR} /
        "canonical-unsigned-batch.json"));

    EXPECT_EQ(canonicalize(contract::to_json_document(batch, false)), canonical_fixture);
    EXPECT_EQ(signer.signing_input(batch),
              std::string{contract::ContractProfile::signing_domain} + canonical_fixture);

    signer.sign(batch);
    ASSERT_TRUE(batch.integrity.value.has_value());
    EXPECT_EQ(*batch.integrity.value,
              vector.at("signature_base64url").get<std::string>());
    EXPECT_TRUE(signer.verify(batch));
    EXPECT_EQ(contract::parse_event_batch(contract::serialize(batch)), batch);
}

TEST(ContractSigner, DetectsPayloadSecretAndKeyTampering) {
    const auto secret = test_secret();
    const ContractSigner signer{"collector-test-key-01", secret};
    auto batch = unsigned_batch();
    signer.sign(batch);

    auto payload_tampered = batch;
    payload_tampered.events.front().raw_payload += " ";
    EXPECT_FALSE(signer.verify(payload_tampered));

    const auto wrong_secret = test_secret('B');
    const ContractSigner wrong_secret_signer{"collector-test-key-01", wrong_secret};
    EXPECT_FALSE(wrong_secret_signer.verify(batch));

    auto key_tampered = batch;
    key_tampered.integrity.key_id = "another-key";
    EXPECT_FALSE(signer.verify(key_tampered));
}

TEST(ContractSigner, SignsHeartbeatAndRejectedEventWithTheSameContract) {
    const auto secret = test_secret();
    const ContractSigner signer{"collector-test-key-01", secret};
    auto heartbeat = contract::parse_heartbeat(
        load_text(std::filesystem::path{COLLECTOR_CONTRACT_FIXTURE_DIR} /
                  "heartbeat.json"));
    auto rejected = contract::parse_rejected_event(
        load_text(std::filesystem::path{COLLECTOR_CONTRACT_FIXTURE_DIR} /
                  "rejected-event.json"));
    heartbeat.integrity.value.reset();
    rejected.integrity.value.reset();

    signer.sign(heartbeat);
    signer.sign(rejected);

    EXPECT_TRUE(signer.verify(heartbeat));
    EXPECT_TRUE(signer.verify(rejected));
    EXPECT_EQ(heartbeat.integrity.key_id, signer.key_id());
    EXPECT_EQ(rejected.integrity.key_id, signer.key_id());
}

TEST(ContractSigner, RejectsInvalidKeyIdentifierWithoutExposingSecret) {
    const auto secret = test_secret();
    EXPECT_THROW(ContractSigner("invalid key id", secret), contract::ContractError);
    EXPECT_EQ(secret.redacted(), "[REDACTED]");
}

} // namespace
} // namespace trivikrama::collector::security
