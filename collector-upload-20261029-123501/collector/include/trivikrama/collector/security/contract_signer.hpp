#pragma once

#include "trivikrama/collector/config/config.hpp"
#include "trivikrama/collector/contract/domain_types.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::security {

class SigningError final : public std::runtime_error {
  public:
    using std::runtime_error::runtime_error;
};

class ContractSigner final {
  public:
    ContractSigner(std::string key_id, const config::SecretValue& secret);
    ~ContractSigner();

    ContractSigner(const ContractSigner&) = delete;
    ContractSigner& operator=(const ContractSigner&) = delete;
    ContractSigner(ContractSigner&&) = delete;
    ContractSigner& operator=(ContractSigner&&) = delete;

    void sign(contract::EventBatch& batch) const;
    void sign(contract::Heartbeat& heartbeat) const;
    void sign(contract::RejectedEvent& rejected) const;

    [[nodiscard]] bool verify(const contract::EventBatch& batch) const;
    [[nodiscard]] bool verify(const contract::Heartbeat& heartbeat) const;
    [[nodiscard]] bool verify(const contract::RejectedEvent& rejected) const;

    [[nodiscard]] std::string signing_input(const contract::EventBatch& batch) const;
    [[nodiscard]] std::string signing_input(const contract::Heartbeat& heartbeat) const;
    [[nodiscard]] std::string signing_input(const contract::RejectedEvent& rejected) const;

    [[nodiscard]] const std::string& key_id() const noexcept { return key_id_; }

  private:
    static constexpr std::size_t key_bytes =
        contract::ContractProfile::decoded_secret_length;

    [[nodiscard]] std::string signature_for(std::string_view input) const;
    [[nodiscard]] bool constant_time_matches(std::string_view expected,
                                             std::string_view actual) const noexcept;
    void clear() noexcept;

    std::string key_id_;
    std::array<std::uint8_t, key_bytes> key_{};
};

} // namespace trivikrama::collector::security
