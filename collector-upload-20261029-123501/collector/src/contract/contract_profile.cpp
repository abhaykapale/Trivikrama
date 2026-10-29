#include "trivikrama/collector/contract/contract_profile.hpp"

namespace trivikrama::collector::contract {

bool ContractProfile::is_supported_contract_version(const std::string_view version) noexcept {
    return version == contract_version;
}

bool ContractProfile::is_supported_ocsf_version(const std::string_view version) noexcept {
    return version == ocsf_schema_version;
}

} // namespace trivikrama::collector::contract

