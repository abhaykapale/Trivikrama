#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>

namespace trivikrama::collector::pipeline {

struct BatchDescriptor final {
    std::string batch_id;
    std::string collector_id;
    std::string created_at;
    std::string key_id;
};

enum class BatchAddResult {
    accepted,
    flush_required,
    event_too_large,
    invalid_event,
};

class BatchAssemblerError final : public std::runtime_error {
  public:
    using std::runtime_error::runtime_error;
};

class BatchAssembler final {
  public:
    using MonotonicTime = std::chrono::steady_clock::time_point;

    BatchAssembler(std::size_t maximum_events, std::size_t maximum_encoded_bytes,
                   std::chrono::seconds maximum_dwell_time);

    void begin(BatchDescriptor descriptor, MonotonicTime started_at);
    [[nodiscard]] BatchAddResult try_add(contract::ContractEvent event);
    [[nodiscard]] bool should_flush(MonotonicTime now) const noexcept;
    [[nodiscard]] bool active() const noexcept;
    [[nodiscard]] bool full() const noexcept;
    [[nodiscard]] bool empty() const noexcept;
    [[nodiscard]] std::size_t event_count() const noexcept;
    [[nodiscard]] std::size_t estimated_encoded_bytes() const noexcept;
    [[nodiscard]] contract::EventBatch seal();
    void discard_empty();

  private:
    [[nodiscard]] std::size_t encoded_contribution(const contract::ContractEvent& event) const;

    const std::size_t maximum_events_;
    const std::size_t maximum_encoded_bytes_;
    const std::chrono::seconds maximum_dwell_time_;
    std::optional<contract::EventBatch> batch_;
    MonotonicTime started_at_{};
    std::size_t empty_batch_bytes_{};
    std::size_t encoded_bytes_{};
};

} // namespace trivikrama::collector::pipeline
