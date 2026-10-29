#include "trivikrama/collector/durability/rejected_event_publisher.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"

#include <algorithm>
#include <filesystem>
#include <stdexcept>
#include <string_view>
#include <utility>
#include <vector>

namespace trivikrama::collector::durability {
namespace {

struct PendingRejection final {
    contract::RejectedEvent rejected;
    std::string encoded;
    std::filesystem::path pending_path;
};

[[nodiscard]] bool valid_collector_id(const std::string_view value) noexcept {
    return !value.empty() && value.size() <= 64U &&
           std::all_of(value.begin(), value.end(), [](const char character) {
               return (character >= 'a' && character <= 'z') ||
                      (character >= '0' && character <= '9') || character == '.' ||
                      character == '_' || character == '-';
           });
}

void ensure_directory(const std::filesystem::path& path) {
    std::error_code error;
    std::filesystem::create_directories(path, error);
    if (error || !std::filesystem::is_directory(path, error) || error) {
        throw std::runtime_error{"cannot create rejected-event directory: " + path.string()};
    }
}

[[nodiscard]] SourcePositions position_for(const contract::RejectedEvent& rejected) {
    return {{rejected.source.source_id,
             contract::Json{{"file_identity", rejected.source.file_identity},
                            {"start_offset", rejected.source.record_start_offset},
                            {"end_offset", rejected.source.record_end_offset}}}};
}

[[nodiscard]] RejectedEventReceipt publish_pending(
    const PendingRejection& pending, const std::filesystem::path& records_directory,
    CheckpointWriter& checkpoints, const std::string& committed_at) {
    const auto final_path = records_directory / (pending.rejected.rejection_id + ".json");
    std::error_code error;
    const auto exists = std::filesystem::exists(final_path, error);
    if (error) {
        throw std::runtime_error{"cannot inspect rejected event: " + error.message()};
    }
    if (exists) {
        if (read_file_bounded(final_path,
                              contract::ContractProfile::maximum_encoded_event_bytes) !=
            pending.encoded) {
            throw std::runtime_error{"rejection id collision"};
        }
    } else {
        auto temporary = final_path;
        temporary += ".tmp";
        write_file_durable(temporary, pending.encoded);
        rename_durable(temporary, final_path, false);
    }
    checkpoints.commit(pending.rejected.collector_id,
                       CheckpointPublicationKind::rejected_event,
                       pending.rejected.rejection_id, committed_at,
                       position_for(pending.rejected));
    remove_file_durable(pending.pending_path);
    return RejectedEventReceipt{pending.rejected.rejection_id, final_path,
                                pending.encoded.size()};
}

} // namespace

RejectedEventPublisher::RejectedEventPublisher(std::string collector_id,
                                               std::filesystem::path rejected_root,
                                               CheckpointWriter& checkpoints)
    : collector_id_{std::move(collector_id)}, checkpoints_{checkpoints},
      pending_directory_{rejected_root / collector_id_ / "pending"},
      records_directory_{std::move(rejected_root) / collector_id_ / "records"} {
    if (!valid_collector_id(collector_id_)) {
        throw std::invalid_argument{"collector id must match [a-z0-9._-]{1,64}"};
    }
    ensure_directory(pending_directory_);
    ensure_directory(records_directory_);
}

RejectedEventReceipt RejectedEventPublisher::publish_signed(
    const contract::RejectedEvent& rejected, const std::string& committed_at) {
    std::lock_guard lock{mutex_};
    if (rejected.collector_id != collector_id_) {
        throw std::invalid_argument{"rejected event belongs to a different collector"};
    }
    auto encoded = contract::serialize(rejected, true);
    auto pending_path = pending_directory_ / (rejected.rejection_id + ".json");
    std::error_code error;
    const auto pending_exists = std::filesystem::exists(pending_path, error);
    if (error) {
        throw std::runtime_error{"cannot inspect pending rejected event: " +
                                 error.message()};
    }
    if (pending_exists) {
        if (read_file_bounded(pending_path,
                              contract::ContractProfile::maximum_encoded_event_bytes) !=
            encoded) {
            throw std::runtime_error{"pending rejection id collision"};
        }
    } else {
        auto temporary = pending_path;
        temporary += ".tmp";
        write_file_durable(temporary, encoded);
        rename_durable(temporary, pending_path, false);
    }
    const PendingRejection pending{rejected, std::move(encoded), std::move(pending_path)};
    return publish_pending(pending, records_directory_, checkpoints_, committed_at);
}

std::size_t RejectedEventPublisher::recover(const std::string& recovered_at) {
    std::lock_guard lock{mutex_};
    std::vector<PendingRejection> pending;
    std::error_code error;
    for (std::filesystem::directory_iterator iterator{pending_directory_, error}, end;
         !error && iterator != end; iterator.increment(error)) {
        if (!iterator->is_regular_file(error) || error) {
            break;
        }
        if (iterator->path().extension() == ".tmp") {
            remove_file_durable(iterator->path());
            continue;
        }
        auto encoded = read_file_bounded(
            iterator->path(), contract::ContractProfile::maximum_encoded_event_bytes);
        auto rejected = contract::parse_rejected_event(
            encoded, contract::SignatureRequirement::required);
        if (rejected.collector_id != collector_id_) {
            throw std::runtime_error{"pending rejection belongs to another collector"};
        }
        pending.push_back(
            PendingRejection{std::move(rejected), std::move(encoded), iterator->path()});
    }
    if (error) {
        throw std::runtime_error{"cannot scan pending rejected events: " + error.message()};
    }
    std::sort(pending.begin(), pending.end(),
              [](const PendingRejection& left, const PendingRejection& right) {
                  return std::tie(left.rejected.rejected_at, left.rejected.rejection_id) <
                         std::tie(right.rejected.rejected_at, right.rejected.rejection_id);
              });
    for (const auto& item : pending) {
        static_cast<void>(
            publish_pending(item, records_directory_, checkpoints_, recovered_at));
    }
    return pending.size();
}

} // namespace trivikrama::collector::durability
