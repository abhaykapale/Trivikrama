#include "trivikrama/collector/security/payload_encoding.hpp"

#include <openssl/evp.h>

#include <array>
#include <cstddef>
#include <iomanip>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace trivikrama::collector::security {

struct Sha256Accumulator::Implementation final {
    Implementation() : context{EVP_MD_CTX_new(), &EVP_MD_CTX_free} {
        if (!context) {
            throw std::runtime_error{"cannot allocate SHA-256 context"};
        }
    }

    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context;
};

Sha256Accumulator::Sha256Accumulator()
    : implementation_{std::make_unique<Implementation>()} {
    reset();
}

Sha256Accumulator::~Sha256Accumulator() = default;
Sha256Accumulator::Sha256Accumulator(Sha256Accumulator&&) noexcept = default;
Sha256Accumulator& Sha256Accumulator::operator=(Sha256Accumulator&&) noexcept = default;

void Sha256Accumulator::reset() {
    if (EVP_DigestInit_ex(implementation_->context.get(), EVP_sha256(), nullptr) != 1) {
        throw std::runtime_error{"cannot initialize SHA-256 context"};
    }
}

void Sha256Accumulator::update(const std::string_view value) {
    if (!value.empty() &&
        EVP_DigestUpdate(implementation_->context.get(), value.data(), value.size()) != 1) {
        throw std::runtime_error{"cannot update SHA-256 digest"};
    }
}

std::string Sha256Accumulator::finish_hex() {
    std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
    unsigned int size{};
    if (EVP_DigestFinal_ex(implementation_->context.get(), digest.data(), &size) != 1 ||
        size != 32U) {
        throw std::runtime_error{"cannot finalize SHA-256 digest"};
    }
    std::ostringstream encoded;
    encoded << std::hex << std::setfill('0');
    for (std::size_t index = 0U; index < size; ++index) {
        encoded << std::setw(2) << static_cast<unsigned int>(digest[index]);
    }
    reset();
    return encoded.str();
}

std::string sha256_hex(const std::string_view value) {
    Sha256Accumulator accumulator;
    accumulator.update(value);
    return accumulator.finish_hex();
}

std::string base64_encode(const std::string_view value) {
    if (value.size() > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        throw std::invalid_argument{"base64 input exceeds the OpenSSL interface"};
    }
    const auto encoded_size = 4U * ((value.size() + 2U) / 3U);
    std::string result(encoded_size, '\0');
    if (value.empty()) {
        return result;
    }
    const auto written = EVP_EncodeBlock(
        reinterpret_cast<unsigned char*>(result.data()),
        reinterpret_cast<const unsigned char*>(value.data()),
        static_cast<int>(value.size()));
    if (written < 0 || static_cast<std::size_t>(written) != encoded_size) {
        throw std::runtime_error{"OpenSSL base64 encoding failed"};
    }
    return result;
}

} // namespace trivikrama::collector::security
