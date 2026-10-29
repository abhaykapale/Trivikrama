#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace trivikrama::collector::contract {

struct ContractProfile final {
    static constexpr std::string_view contract_version{"1.0.0"};
    static constexpr std::string_view ocsf_schema_version{"1.1.0"};
    static constexpr std::string_view event_batch_message_type{"event_batch"};
    static constexpr std::string_view heartbeat_message_type{"heartbeat"};
    static constexpr std::string_view rejected_event_message_type{"rejected_event"};
    static constexpr std::string_view signature_algorithm{"HMAC-SHA256"};
    static constexpr std::string_view signing_domain{
        "TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n"};

    static constexpr std::size_t maximum_events_per_batch{1'000U};
    static constexpr std::size_t maximum_encoded_batch_bytes{8U * 1024U * 1024U};
    static constexpr std::size_t maximum_encoded_event_bytes{512U * 1024U};
    static constexpr std::chrono::seconds maximum_batch_dwell_time{5};

    static constexpr std::uint64_t maximum_outbox_bytes{10ULL * 1024ULL * 1024ULL * 1024ULL};
    static constexpr std::size_t maximum_outbox_batches{10'000U};
    static constexpr std::chrono::seconds heartbeat_interval{30};
    static constexpr std::chrono::seconds offline_after{60};

    static constexpr std::size_t encoded_secret_length{64U};
    static constexpr std::size_t decoded_secret_length{48U};
    static constexpr std::size_t encoded_signature_length{43U};

    [[nodiscard]] static bool is_supported_contract_version(std::string_view version) noexcept;
    [[nodiscard]] static bool is_supported_ocsf_version(std::string_view version) noexcept;
};

} // namespace trivikrama::collector::contract

