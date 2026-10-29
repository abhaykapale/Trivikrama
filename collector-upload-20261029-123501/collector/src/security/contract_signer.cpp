#include "trivikrama/collector/security/contract_signer.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/security/canonical_json.hpp"

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace trivikrama::collector::security {
namespace {

[[nodiscard]] std::uint8_t decode_character(const char character) {
    if (character >= 'A' && character <= 'Z') {
        return static_cast<std::uint8_t>(character - 'A');
    }
    if (character >= 'a' && character <= 'z') {
        return static_cast<std::uint8_t>(character - 'a' + 26);
    }
    if (character >= '0' && character <= '9') {
        return static_cast<std::uint8_t>(character - '0' + 52);
    }
    if (character == '-') {
        return 62U;
    }
    if (character == '_') {
        return 63U;
    }
    throw SigningError{"secret contains a non-base64url character"};
}

[[nodiscard]] std::array<std::uint8_t, contract::ContractProfile::decoded_secret_length>
decode_secret(const std::string_view encoded) {
    if (encoded.size() != contract::ContractProfile::encoded_secret_length) {
        throw SigningError{"secret must contain exactly 64 base64url characters"};
    }
    std::array<std::uint8_t, contract::ContractProfile::decoded_secret_length> decoded{};
    std::size_t input_index = 0U;
    std::size_t output_index = 0U;
    while (input_index < encoded.size()) {
        const auto first = decode_character(encoded[input_index]);
        const auto second = decode_character(encoded[input_index + 1U]);
        const auto third = decode_character(encoded[input_index + 2U]);
        const auto fourth = decode_character(encoded[input_index + 3U]);
        decoded[output_index] = static_cast<std::uint8_t>((first << 2U) | (second >> 4U));
        decoded[output_index + 1U] =
            static_cast<std::uint8_t>((second << 4U) | (third >> 2U));
        decoded[output_index + 2U] =
            static_cast<std::uint8_t>((third << 6U) | fourth);
        input_index += 4U;
        output_index += 3U;
    }
    return decoded;
}

[[nodiscard]] std::string encode_signature(const std::array<unsigned char, 32U>& digest) {
    static constexpr std::string_view alphabet{
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"};
    std::string encoded;
    encoded.reserve(contract::ContractProfile::encoded_signature_length);
    std::size_t index = 0U;
    while (index + 3U <= digest.size()) {
        const auto block = (static_cast<std::uint32_t>(digest[index]) << 16U) |
                           (static_cast<std::uint32_t>(digest[index + 1U]) << 8U) |
                           static_cast<std::uint32_t>(digest[index + 2U]);
        encoded.push_back(alphabet[(block >> 18U) & 0x3FU]);
        encoded.push_back(alphabet[(block >> 12U) & 0x3FU]);
        encoded.push_back(alphabet[(block >> 6U) & 0x3FU]);
        encoded.push_back(alphabet[block & 0x3FU]);
        index += 3U;
    }
    const auto remaining = digest.size() - index;
    if (remaining == 2U) {
        const auto block = (static_cast<std::uint32_t>(digest[index]) << 16U) |
                           (static_cast<std::uint32_t>(digest[index + 1U]) << 8U);
        encoded.push_back(alphabet[(block >> 18U) & 0x3FU]);
        encoded.push_back(alphabet[(block >> 12U) & 0x3FU]);
        encoded.push_back(alphabet[(block >> 6U) & 0x3FU]);
    } else if (remaining == 1U) {
        const auto block = static_cast<std::uint32_t>(digest[index]) << 16U;
        encoded.push_back(alphabet[(block >> 18U) & 0x3FU]);
        encoded.push_back(alphabet[(block >> 12U) & 0x3FU]);
    }
    if (encoded.size() != contract::ContractProfile::encoded_signature_length) {
        throw SigningError{"HMAC signature encoding produced an invalid length"};
    }
    return encoded;
}

template <typename Message>
[[nodiscard]] std::string make_signing_input(Message message, const std::string& key_id) {
    message.integrity.algorithm = contract::ContractProfile::signature_algorithm;
    message.integrity.key_id = key_id;
    message.integrity.value.reset();
    auto result = std::string{contract::ContractProfile::signing_domain};
    result += canonicalize(contract::to_json_document(message, false));
    return result;
}

} // namespace

ContractSigner::ContractSigner(std::string key_id, const config::SecretValue& secret)
    : key_id_{std::move(key_id)}, key_{decode_secret(secret.encoded())} {
    contract::EventBatch probe;
    probe.batch_id = "123e4567-e89b-42d3-a456-426614174000";
    probe.collector_id = "signer-validation";
    probe.created_at = "2000-01-01T00:00:00Z";
    probe.integrity.key_id = key_id_;
    try {
        static_cast<void>(contract::serialize(probe, false));
    } catch (...) {
        clear();
        throw;
    }
}

ContractSigner::~ContractSigner() { clear(); }

void ContractSigner::sign(contract::EventBatch& batch) const {
    auto candidate = batch;
    candidate.integrity.algorithm = contract::ContractProfile::signature_algorithm;
    candidate.integrity.key_id = key_id_;
    candidate.integrity.value.reset();
    candidate.integrity.value = signature_for(signing_input(candidate));
    batch.integrity = std::move(candidate.integrity);
}

void ContractSigner::sign(contract::Heartbeat& heartbeat) const {
    auto candidate = heartbeat;
    candidate.integrity.algorithm = contract::ContractProfile::signature_algorithm;
    candidate.integrity.key_id = key_id_;
    candidate.integrity.value.reset();
    candidate.integrity.value = signature_for(signing_input(candidate));
    heartbeat.integrity = std::move(candidate.integrity);
}

void ContractSigner::sign(contract::RejectedEvent& rejected) const {
    auto candidate = rejected;
    candidate.integrity.algorithm = contract::ContractProfile::signature_algorithm;
    candidate.integrity.key_id = key_id_;
    candidate.integrity.value.reset();
    candidate.integrity.value = signature_for(signing_input(candidate));
    rejected.integrity = std::move(candidate.integrity);
}

bool ContractSigner::verify(const contract::EventBatch& batch) const {
    if (batch.integrity.algorithm != contract::ContractProfile::signature_algorithm ||
        batch.integrity.key_id != key_id_ || !batch.integrity.value.has_value()) {
        return false;
    }
    try {
        return constant_time_matches(signature_for(signing_input(batch)),
                                     *batch.integrity.value);
    } catch (const std::exception&) {
        return false;
    }
}

bool ContractSigner::verify(const contract::Heartbeat& heartbeat) const {
    if (heartbeat.integrity.algorithm != contract::ContractProfile::signature_algorithm ||
        heartbeat.integrity.key_id != key_id_ || !heartbeat.integrity.value.has_value()) {
        return false;
    }
    try {
        return constant_time_matches(signature_for(signing_input(heartbeat)),
                                     *heartbeat.integrity.value);
    } catch (const std::exception&) {
        return false;
    }
}

bool ContractSigner::verify(const contract::RejectedEvent& rejected) const {
    if (rejected.integrity.algorithm != contract::ContractProfile::signature_algorithm ||
        rejected.integrity.key_id != key_id_ || !rejected.integrity.value.has_value()) {
        return false;
    }
    try {
        return constant_time_matches(signature_for(signing_input(rejected)),
                                     *rejected.integrity.value);
    } catch (const std::exception&) {
        return false;
    }
}

std::string ContractSigner::signing_input(const contract::EventBatch& batch) const {
    return make_signing_input(batch, key_id_);
}

std::string ContractSigner::signing_input(const contract::Heartbeat& heartbeat) const {
    return make_signing_input(heartbeat, key_id_);
}

std::string ContractSigner::signing_input(const contract::RejectedEvent& rejected) const {
    return make_signing_input(rejected, key_id_);
}

std::string ContractSigner::signature_for(const std::string_view input) const {
    if (key_.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        throw SigningError{"HMAC key length exceeds the OpenSSL interface"};
    }
    std::array<unsigned char, EVP_MAX_MD_SIZE> output{};
    unsigned int output_size{};
    const auto* result = HMAC(EVP_sha256(), key_.data(), static_cast<int>(key_.size()),
                              reinterpret_cast<const unsigned char*>(input.data()),
                              input.size(), output.data(), &output_size);
    if (result == nullptr || output_size != 32U) {
        OPENSSL_cleanse(output.data(), output.size());
        throw SigningError{"OpenSSL HMAC-SHA256 failed"};
    }
    std::array<unsigned char, 32U> digest{};
    std::copy_n(output.begin(), digest.size(), digest.begin());
    OPENSSL_cleanse(output.data(), output.size());
    auto encoded = encode_signature(digest);
    OPENSSL_cleanse(digest.data(), digest.size());
    return encoded;
}

bool ContractSigner::constant_time_matches(const std::string_view expected,
                                           const std::string_view actual) const noexcept {
    if (expected.size() != actual.size()) {
        return false;
    }
    return CRYPTO_memcmp(expected.data(), actual.data(), expected.size()) == 0;
}

void ContractSigner::clear() noexcept { OPENSSL_cleanse(key_.data(), key_.size()); }

} // namespace trivikrama::collector::security
