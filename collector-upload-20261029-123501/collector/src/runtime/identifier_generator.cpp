#include "trivikrama/collector/runtime/identifier_generator.hpp"

#include <openssl/rand.h>

#include <array>
#include <cstddef>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace trivikrama::collector::runtime {

std::string RandomIdentifierGenerator::next_uuid_v4() {
    std::lock_guard lock{mutex_};
    std::array<std::uint8_t, 16U> bytes{};
    if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
        throw std::runtime_error{"OpenSSL could not generate a random UUID"};
    }
    bytes[6] = static_cast<std::uint8_t>((bytes[6] & 0x0FU) | 0x40U);
    bytes[8] = static_cast<std::uint8_t>((bytes[8] & 0x3FU) | 0x80U);

    std::ostringstream encoded;
    encoded << std::hex << std::setfill('0');
    for (std::size_t index = 0U; index < bytes.size(); ++index) {
        if (index == 4U || index == 6U || index == 8U || index == 10U) {
            encoded << '-';
        }
        encoded << std::setw(2) << static_cast<unsigned int>(bytes[index]);
    }
    return encoded.str();
}

} // namespace trivikrama::collector::runtime
