#include "trivikrama/collector/security/canonical_json.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace trivikrama::collector::security {
namespace {

constexpr std::uint64_t maximum_safe_integer = 9'007'199'254'740'991ULL;

[[noreturn]] void fail(const std::string& message) { throw CanonicalizationError{message}; }

[[nodiscard]] std::vector<std::uint32_t> decode_utf8(const std::string_view input) {
    std::vector<std::uint32_t> code_points;
    code_points.reserve(input.size());
    for (std::size_t index = 0U; index < input.size();) {
        const auto first = static_cast<std::uint8_t>(input[index]);
        std::uint32_t value{};
        std::size_t length{};
        if (first <= 0x7FU) {
            value = first;
            length = 1U;
        } else if (first >= 0xC2U && first <= 0xDFU) {
            value = static_cast<std::uint32_t>(first & 0x1FU);
            length = 2U;
        } else if (first >= 0xE0U && first <= 0xEFU) {
            value = static_cast<std::uint32_t>(first & 0x0FU);
            length = 3U;
        } else if (first >= 0xF0U && first <= 0xF4U) {
            value = static_cast<std::uint32_t>(first & 0x07U);
            length = 4U;
        } else {
            fail("invalid UTF-8 in JSON string");
        }
        if (length > input.size() - index) {
            fail("truncated UTF-8 in JSON string");
        }
        for (std::size_t offset = 1U; offset < length; ++offset) {
            const auto continuation = static_cast<std::uint8_t>(input[index + offset]);
            if ((continuation & 0xC0U) != 0x80U) {
                fail("invalid UTF-8 continuation byte in JSON string");
            }
            value = (value << 6U) | static_cast<std::uint32_t>(continuation & 0x3FU);
        }
        const auto overlong = (length == 2U && value < 0x80U) ||
                              (length == 3U && value < 0x800U) ||
                              (length == 4U && value < 0x10000U);
        if (overlong || value > 0x10FFFFU || (value >= 0xD800U && value <= 0xDFFFU)) {
            fail("invalid Unicode scalar value in JSON string");
        }
        code_points.push_back(value);
        index += length;
    }
    return code_points;
}

[[nodiscard]] std::vector<std::uint16_t> utf16_units(const std::string_view input) {
    std::vector<std::uint16_t> result;
    for (const auto code_point : decode_utf8(input)) {
        if (code_point <= 0xFFFFU) {
            result.push_back(static_cast<std::uint16_t>(code_point));
        } else {
            const auto adjusted = code_point - 0x10000U;
            result.push_back(static_cast<std::uint16_t>(0xD800U + (adjusted >> 10U)));
            result.push_back(static_cast<std::uint16_t>(0xDC00U + (adjusted & 0x3FFU)));
        }
    }
    return result;
}

void append_string(std::string& output, const std::string_view value) {
    static constexpr std::array hex{'0', '1', '2', '3', '4', '5', '6', '7',
                                    '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'};
    static_cast<void>(decode_utf8(value));
    output.push_back('"');
    for (const auto character : value) {
        const auto byte = static_cast<std::uint8_t>(character);
        switch (byte) {
        case '"':
            output += "\\\"";
            break;
        case '\\':
            output += "\\\\";
            break;
        case '\b':
            output += "\\b";
            break;
        case '\t':
            output += "\\t";
            break;
        case '\n':
            output += "\\n";
            break;
        case '\f':
            output += "\\f";
            break;
        case '\r':
            output += "\\r";
            break;
        default:
            if (byte < 0x20U) {
                output += "\\u00";
                output.push_back(hex[byte >> 4U]);
                output.push_back(hex[byte & 0x0FU]);
            } else {
                output.push_back(character);
            }
        }
    }
    output.push_back('"');
}

template <typename Integer>
void append_integer(std::string& output, const Integer value) {
    std::array<char, 32U> buffer{};
    const auto result = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value);
    if (result.ec != std::errc{}) {
        fail("integer serialization failed");
    }
    output.append(buffer.data(), result.ptr);
}

[[nodiscard]] int parse_exponent(std::string_view value) {
    if (!value.empty() && value.front() == '+') {
        value.remove_prefix(1U);
    }

    int result{};
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);

    if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) {
        fail("floating-point exponent serialization failed");
    }

    return result;
}

void append_float(std::string& output, const double value) {
    if (!std::isfinite(value)) {
        fail("non-finite JSON number is not canonicalizable");
    }
    if (value == 0.0) {
        output.push_back('0');
        return;
    }

    std::array<char, 64U> buffer{};
    const auto converted = std::to_chars(buffer.data(), buffer.data() + buffer.size(), value,
                                         std::chars_format::general);
    if (converted.ec != std::errc{}) {
        fail("floating-point serialization failed");
    }
    std::string_view shortest{buffer.data(),
                              static_cast<std::size_t>(converted.ptr - buffer.data())};
    if (shortest.front() == '-') {
        output.push_back('-');
        shortest.remove_prefix(1U);
    }

    const auto exponent_marker = shortest.find_first_of("eE");
    const auto mantissa = shortest.substr(0U, exponent_marker);
    const auto exponent = exponent_marker == std::string_view::npos
                              ? 0
                              : parse_exponent(shortest.substr(exponent_marker + 1U));
    const auto decimal_point = mantissa.find('.');
    const auto integer_digits = decimal_point == std::string_view::npos
                                    ? mantissa.size()
                                    : decimal_point;
    std::string digits{mantissa};
    if (decimal_point != std::string_view::npos) {
        digits.erase(decimal_point, 1U);
    }
    const auto decimal_position = static_cast<int>(integer_digits) + exponent;
    const auto digit_count = static_cast<int>(digits.size());

    if (decimal_position > 0 && decimal_position <= 21) {
        if (decimal_position >= digit_count) {
            output += digits;
            output.append(static_cast<std::size_t>(decimal_position - digit_count), '0');
        } else {
            output.append(digits.data(), static_cast<std::size_t>(decimal_position));
            output.push_back('.');
            output.append(digits.data() + decimal_position,
                          static_cast<std::size_t>(digit_count - decimal_position));
        }
        return;
    }
    if (decimal_position <= 0 && decimal_position > -6) {
        output += "0.";
        output.append(static_cast<std::size_t>(-decimal_position), '0');
        output += digits;
        return;
    }

    output.push_back(digits.front());
    if (digits.size() > 1U) {
        output.push_back('.');
        output.append(digits.data() + 1, digits.size() - 1U);
    }
    const auto scientific_exponent = decimal_position - 1;
    output.push_back('e');
    if (scientific_exponent >= 0) {
        output.push_back('+');
    }
    append_integer(output, scientific_exponent);
}

void append_value(std::string& output, const contract::Json& value) {
    if (value.is_null()) {
        output += "null";
    } else if (value.is_boolean()) {
        output += value.get<bool>() ? "true" : "false";
    } else if (value.is_number_unsigned()) {
        const auto number = value.get<std::uint64_t>();
        if (number > maximum_safe_integer) {
            fail("unsigned integer exceeds the project safe-integer range");
        }
        append_integer(output, number);
    } else if (value.is_number_integer()) {
        const auto number = value.get<std::int64_t>();
        if (number < -static_cast<std::int64_t>(maximum_safe_integer) ||
            number > static_cast<std::int64_t>(maximum_safe_integer)) {
            fail("signed integer exceeds the project safe-integer range");
        }
        append_integer(output, number);
    } else if (value.is_number_float()) {
        append_float(output, value.get<double>());
    } else if (value.is_string()) {
        append_string(output, value.get_ref<const std::string&>());
    } else if (value.is_array()) {
        output.push_back('[');
        for (std::size_t index = 0U; index < value.size(); ++index) {
            if (index != 0U) {
                output.push_back(',');
            }
            append_value(output, value.at(index));
        }
        output.push_back(']');
    } else if (value.is_object()) {
        struct Member final {
            std::string_view key;
            std::vector<std::uint16_t> sort_key;
            const contract::Json* value;
        };
        std::vector<Member> members;
        members.reserve(value.size());
        for (const auto& [key, child] : value.items()) {
            members.push_back(Member{key, utf16_units(key), &child});
        }
        std::sort(members.begin(), members.end(), [](const Member& left, const Member& right) {
            return left.sort_key < right.sort_key;
        });
        output.push_back('{');
        for (std::size_t index = 0U; index < members.size(); ++index) {
            if (index != 0U) {
                output.push_back(',');
            }
            append_string(output, members[index].key);
            output.push_back(':');
            append_value(output, *members[index].value);
        }
        output.push_back('}');
    } else {
        fail("binary or discarded JSON values are not canonicalizable");
    }
}

} // namespace

std::string canonicalize(const contract::Json& value) {
    std::string output;
    output.reserve(256U);
    append_value(output, value);
    return output;
}

} // namespace trivikrama::collector::security
