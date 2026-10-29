#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <cstddef>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace trivikrama::collector::pipeline {

enum class AdmissionResult {
    accepted,
    event_limit_reached,
    byte_limit_reached,
    source_event_limit_reached,
    source_byte_limit_reached,
    event_too_large,
};

struct QueueSnapshot final {
    std::size_t events{};
    std::uint64_t bytes{};
    std::size_t maximum_events{};
    std::uint64_t maximum_bytes{};
};

class BoundedEventQueue final {
  public:
    BoundedEventQueue(std::size_t maximum_events, std::uint64_t maximum_bytes);
    BoundedEventQueue(std::size_t maximum_events, std::uint64_t maximum_bytes,
                      std::size_t maximum_events_per_source,
                      std::uint64_t maximum_bytes_per_source);

    [[nodiscard]] AdmissionResult try_push(contract::ContractEvent event);
    [[nodiscard]] std::optional<contract::ContractEvent> try_pop();
    [[nodiscard]] QueueSnapshot snapshot() const;

    [[nodiscard]] static std::uint64_t accounted_bytes(
        const contract::ContractEvent& event);

  private:
    struct Entry final {
        contract::ContractEvent event;
        std::string source_id;
        std::uint64_t bytes{};
    };

    struct SourceUsage final {
        std::size_t events{};
        std::uint64_t bytes{};
    };

    const std::size_t maximum_events_;
    const std::uint64_t maximum_bytes_;
    const std::size_t maximum_events_per_source_;
    const std::uint64_t maximum_bytes_per_source_;
    mutable std::mutex mutex_;
    std::deque<Entry> entries_;
    std::unordered_map<std::string, SourceUsage> source_usage_;
    std::uint64_t bytes_{};
};

} // namespace trivikrama::collector::pipeline
