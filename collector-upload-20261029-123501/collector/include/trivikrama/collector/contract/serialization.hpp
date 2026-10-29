#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::contract {

enum class SignatureRequirement {
    required,
    allow_unsigned,
};

class ContractError final : public std::runtime_error {
  public:
    ContractError(std::string code, std::string path, std::string message);

    [[nodiscard]] const std::string& code() const noexcept { return code_; }
    [[nodiscard]] const std::string& path() const noexcept { return path_; }

  private:
    std::string code_;
    std::string path_;
};

[[nodiscard]] Json parse_json_strict(std::string_view input);

[[nodiscard]] Json to_json_document(const EventBatch& batch, bool include_signature = true);
[[nodiscard]] Json to_json_document(const Heartbeat& heartbeat, bool include_signature = true);
[[nodiscard]] Json to_json_document(const RejectedEvent& rejected, bool include_signature = true);

[[nodiscard]] std::string serialize(const EventBatch& batch, bool include_signature = true);
[[nodiscard]] std::string serialize(const Heartbeat& heartbeat, bool include_signature = true);
[[nodiscard]] std::string serialize(const RejectedEvent& rejected, bool include_signature = true);

[[nodiscard]] EventBatch parse_event_batch(
    std::string_view input,
    SignatureRequirement signature = SignatureRequirement::required);
[[nodiscard]] Heartbeat parse_heartbeat(
    std::string_view input,
    SignatureRequirement signature = SignatureRequirement::required);
[[nodiscard]] RejectedEvent parse_rejected_event(
    std::string_view input,
    SignatureRequirement signature = SignatureRequirement::required);

[[nodiscard]] std::string_view to_string(HeartbeatStatus status) noexcept;
[[nodiscard]] std::string_view to_string(RejectionStage stage) noexcept;
[[nodiscard]] std::string_view to_string(RejectionCode code) noexcept;

} // namespace trivikrama::collector::contract

