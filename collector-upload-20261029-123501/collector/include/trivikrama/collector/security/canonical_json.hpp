#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <stdexcept>
#include <string>

namespace trivikrama::collector::security {

class CanonicalizationError final : public std::runtime_error {
  public:
    using std::runtime_error::runtime_error;
};

// RFC 8785 / JSON Canonicalization Scheme output. Objects are ordered by their
// UTF-16 code units, strings use minimal JSON escaping, and numbers use the
// ECMAScript-compatible shortest round-trippable representation.
[[nodiscard]] std::string canonicalize(const contract::Json& value);

} // namespace trivikrama::collector::security
