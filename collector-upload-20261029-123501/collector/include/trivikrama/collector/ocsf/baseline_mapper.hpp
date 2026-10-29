#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"
#include "trivikrama/collector/ingress/raw_event.hpp"

#include <variant>

namespace trivikrama::collector::ocsf {

using MappingResult =
    std::variant<contract::ContractEvent, ingress::InputRejection>;

class BaselineMapper final {
  public:
    [[nodiscard]] MappingResult map(const ingress::RawEvent& event) const;
};

} // namespace trivikrama::collector::ocsf
