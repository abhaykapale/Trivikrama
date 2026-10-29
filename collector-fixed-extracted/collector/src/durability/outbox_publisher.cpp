#include "trivikrama/collector/durability/outbox_publisher.hpp"

#include "trivikrama/collector/contract/contract_profile.hpp"
#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"

#include <algorithm>
#include <filesystem>
#include <limits>
#include <string_view>
#include <utility>
#include <vector>

namespace trivikrama::collector::durability {
namespace {

constexpr std::string_view batch_suffix{".batch.json"};
constexpr std::string_view manifest_suffix{".manifest.json"};
constexpr std::size_t maximum_manifest_bytes = 1024U * 1024U;

struct SealedBatch final {
    contract::EventBatch batch;
    std::string encoded;
    SourcePositions positions;
    std::filesystem::path batch_path;
    std::filesystem::path manifest_path;
};

[[nodiscard]] bool is_collector_id(const std::string_view value) noexcept {
    return !value.empty() && value.size() <= 64U &&
           std::all_of(value.begin(), value.end(), [](const char character) {
               return (character >= 'a' && character <= 'z') ||
                      (character >= '0' && character <= '9') || character == '.' ||
                      character == '_' || character == '-';
           });
}

[[nodiscard]] bool ends_with(const std::filesystem::path& path,
                             const std::string_view suffix) {
    return path.filename().string().ends_with(suffix);
}

[[nodiscard]] SourcePositions positions_for(const contract::EventBatch& batch) {
    SourcePositions positions;
    for (const auto& event : batch.events) {
        const auto& position = event.source.position;
        if (position.contains("file_identity") &&
            position.contains("record_end_offset") &&
            position.at("file_identity").is_string() &&
            position.at("record_end_offset").is_number_unsigned()) {
            positions[event.source.source_id] =
                contract::Json{{"file_identity", position.at("file_identity")},
                               {"end_offset", position.at("record_end_offset")}};
        } else {
            positions[event.source.source_id] = position;
        }
    }
    return positions;
}

[[nodiscard]] std::filesystem::path batch_path_for(const std::filesystem::path& directory,
                                                   const std::string& batch_id) {
    return directory / (batch_id + std::string{batch_suffix});
}

[[nodiscard]] std::filesystem::path manifest_path_for(
    const std::filesystem::path& directory, const std::string& batch_id) {
    return directory / (batch_id + std::string{manifest_suffix});
}

[[nodiscard]] std::filesystem::path final_path_for(const std::filesystem::path& directory,
                                                   const std::string& batch_id) {
    return directory / ("batch_" + batch_id + ".json");
}

[[nodiscard]] contract::Json manifest_document(const contract::EventBatch& batch,
                                               const std::size_t encoded_bytes,
                                               const SourcePositions& positions) {
    contract::Json source_document = contract::Json::object();
    for (const auto& [source_id, position] : positions) {
        source_document[source_id] = position;
    }
    return contract::Json{{"version", 1U},
                          {"batch_id", batch.batch_id},
                          {"collector_id", batch.collector_id},
                          {"created_at", batch.created_at},
                          {"encoded_bytes", encoded_bytes},
                          {"source_positions", std::move(source_document)}};
}

void write_manifest(const SealedBatch& sealed) {
    const auto encoded =
        manifest_document(sealed.batch, sealed.encoded.size(), sealed.positions).dump();
    if (encoded.size() > maximum_manifest_bytes) {
        throw std::runtime_error{"outbox recovery manifest exceeds 1 MiB"};
    }
    auto temporary = sealed.manifest_path;
    temporary += ".tmp";
    write_file_durable(temporary, encoded);
    rename_durable(temporary, sealed.manifest_path, false);
}

void validate_manifest(const SealedBatch& sealed) {
    const auto encoded = read_file_bounded(sealed.manifest_path, maximum_manifest_bytes);
    const auto document = contract::parse_json_strict(encoded);
    const auto expected =
        manifest_document(sealed.batch, sealed.encoded.size(), sealed.positions);
    if (document != expected) {
        throw std::runtime_error{"outbox recovery manifest does not match sealed batch"};
    }
}

[[nodiscard]] SealedBatch load_sealed(const std::filesystem::path& path) {
    auto encoded = read_file_bounded(
        path, contract::ContractProfile::maximum_encoded_batch_bytes);
    auto batch = contract::parse_event_batch(encoded, contract::SignatureRequirement::required);
    if (batch.events.empty()) {
        throw std::runtime_error{"sealed outbox batch must contain at least one event"};
    }
    auto manifest_path = manifest_path_for(path.parent_path(), batch.batch_id);
    return SealedBatch{std::move(batch), std::move(encoded), {}, path,
                       std::move(manifest_path)};
}

void ensure_manifest(SealedBatch& sealed) {
    sealed.positions = positions_for(sealed.batch);
    std::error_code error;
    const auto exists = std::filesystem::exists(sealed.manifest_path, error);
    if (error) {
        throw std::runtime_error{"cannot inspect outbox manifest: " + error.message()};
    }
    if (exists) {
        validate_manifest(sealed);
    } else {
        write_manifest(sealed);
    }
}

[[nodiscard]] PublishReceipt publish_sealed(SealedBatch& sealed,
                                            const std::filesystem::path& handoff_directory,
                                            CheckpointWriter& checkpoints,
                                            const std::string& committed_at) {
    const auto final_path = final_path_for(handoff_directory, sealed.batch.batch_id);
    std::error_code error;
    const auto final_exists = std::filesystem::exists(final_path, error);
    if (error) {
        throw std::runtime_error{"cannot inspect handoff batch: " + error.message()};
    }
    if (final_exists) {
        const auto existing = read_file_bounded(
            final_path, contract::ContractProfile::maximum_encoded_batch_bytes);
        if (existing != sealed.encoded) {
            throw std::runtime_error{"handoff batch id collision"};
        }
    } else {
        auto temporary = final_path;
        temporary += ".tmp";
        write_file_durable(temporary, sealed.encoded);
        rename_durable(temporary, final_path, false);
    }

    // This ordering is the reliability invariant: input positions do not advance
    // until the complete signed file is fsynced and atomically visible.
    checkpoints.commit(sealed.batch.collector_id, CheckpointPublicationKind::event_batch,
                       sealed.batch.batch_id, committed_at, sealed.positions);

    // Manifest-first cleanup makes every crash state recoverable: if cleanup is
    // interrupted, the remaining sealed batch can recreate its manifest.
    remove_file_durable(sealed.manifest_path);
    remove_file_durable(sealed.batch_path);
    return PublishReceipt{sealed.batch.batch_id, final_path, sealed.batch.event_count(),
                          sealed.encoded.size()};
}

[[nodiscard]] OutboxUsage inspect_usage(const std::filesystem::path& directory) {
    OutboxUsage usage;
    std::error_code error;
    for (std::filesystem::directory_iterator iterator{directory, error}, end;
         !error && iterator != end; iterator.increment(error)) {
        if (!iterator->is_regular_file(error) || error) {
            break;
        }
        const auto size = iterator->file_size(error);
        if (error || size > std::numeric_limits<std::uint64_t>::max() - usage.bytes) {
            throw std::runtime_error{"cannot account outbox usage"};
        }
        usage.bytes += size;
        if (ends_with(iterator->path(), batch_suffix)) {
            ++usage.batches;
        }
    }
    if (error) {
        throw std::runtime_error{"cannot scan outbox: " + error.message()};
    }
    return usage;
}

void ensure_directory(const std::filesystem::path& path) {
    std::error_code error;
    std::filesystem::create_directories(path, error);
    if (error || !std::filesystem::is_directory(path, error) || error) {
        throw std::runtime_error{"cannot create collector storage directory: " +
                                 path.string()};
    }
}

} // namespace

OutboxPublisher::OutboxPublisher(OutboxPublisherOptions options,
                                 CheckpointWriter& checkpoints)
    : options_{std::move(options)}, checkpoints_{checkpoints},
      outbox_directory_{options_.outbox_root / options_.collector_id},
      handoff_directory_{options_.handoff_root / "incoming" / options_.collector_id} {
    if (!is_collector_id(options_.collector_id)) {
        throw std::invalid_argument{"collector id must match [a-z0-9._-]{1,64}"};
    }
    if (options_.outbox_root.empty() || options_.handoff_root.empty() ||
        options_.outbox_root == options_.handoff_root) {
        throw std::invalid_argument{"outbox and handoff roots must be nonempty and distinct"};
    }
    if (options_.maximum_bytes <
            contract::ContractProfile::maximum_encoded_batch_bytes ||
        options_.maximum_bytes > contract::ContractProfile::maximum_outbox_bytes ||
        options_.maximum_batches == 0U ||
        options_.maximum_batches > contract::ContractProfile::maximum_outbox_batches) {
        throw std::invalid_argument{"outbox capacity is outside the frozen limits"};
    }
    ensure_directory(outbox_directory_);
    ensure_directory(handoff_directory_);
}

PublishReceipt OutboxPublisher::publish_signed(contract::EventBatch batch,
                                               const std::string& committed_at) {
    std::lock_guard lock{mutex_};
    if (batch.collector_id != options_.collector_id) {
        throw std::invalid_argument{"batch belongs to a different collector"};
    }
    if (batch.events.empty()) {
        throw std::invalid_argument{"cannot publish an empty batch"};
    }
    auto encoded = contract::serialize(batch, true);
    auto sealed_path = batch_path_for(outbox_directory_, batch.batch_id);
    auto manifest_path = manifest_path_for(outbox_directory_, batch.batch_id);
    std::error_code error;
    const auto sealed_exists = std::filesystem::exists(sealed_path, error);
    if (error) {
        throw std::runtime_error{"cannot inspect sealed outbox batch: " + error.message()};
    }
    if (sealed_exists) {
        auto sealed = load_sealed(sealed_path);
        if (sealed.encoded != encoded) {
            throw std::runtime_error{"sealed outbox batch id collision"};
        }
        ensure_manifest(sealed);
        return publish_sealed(sealed, handoff_directory_, checkpoints_, committed_at);
    }
    const auto current = inspect_usage(outbox_directory_);
    const auto positions = positions_for(batch);
    const auto manifest_bytes = manifest_document(batch, encoded.size(), positions).dump().size();
    const auto required_bytes = static_cast<std::uint64_t>(encoded.size() + manifest_bytes);
    if (current.batches >= options_.maximum_batches ||
        required_bytes > options_.maximum_bytes - std::min(current.bytes, options_.maximum_bytes)) {
        throw OutboxCapacityError{"durable outbox capacity is exhausted"};
    }

    auto temporary = sealed_path;
    temporary += ".tmp";
    write_file_durable(temporary, encoded);
    rename_durable(temporary, sealed_path, false);
    SealedBatch sealed{std::move(batch), std::move(encoded), positions,
                       std::move(sealed_path), std::move(manifest_path)};
    write_manifest(sealed);
    return publish_sealed(sealed, handoff_directory_, checkpoints_, committed_at);
}

RecoveryReport OutboxPublisher::recover(const std::string& recovered_at) {
    std::lock_guard lock{mutex_};
    RecoveryReport report;
    std::vector<std::filesystem::path> batches;
    std::error_code error;
    for (std::filesystem::directory_iterator iterator{outbox_directory_, error}, end;
         !error && iterator != end; iterator.increment(error)) {
        const auto path = iterator->path();
        if (iterator->is_regular_file(error) && !error && path.extension() == ".tmp") {
            remove_file_durable(path);
            ++report.removed_temporary_files;
        } else if (!error && iterator->is_regular_file(error) && !error &&
                   ends_with(path, batch_suffix)) {
            batches.push_back(path);
        }
        if (error) {
            break;
        }
    }
    if (error) {
        throw std::runtime_error{"cannot scan outbox during recovery: " + error.message()};
    }

    std::vector<SealedBatch> sealed_batches;
    sealed_batches.reserve(batches.size());
    for (const auto& path : batches) {
        auto sealed = load_sealed(path);
        if (sealed.batch.collector_id != options_.collector_id) {
            throw std::runtime_error{"sealed batch belongs to another collector"};
        }
        ensure_manifest(sealed);
        sealed_batches.push_back(std::move(sealed));
    }
    std::sort(sealed_batches.begin(), sealed_batches.end(),
              [](const SealedBatch& left, const SealedBatch& right) {
                  return std::tie(left.batch.created_at, left.batch.batch_id) <
                         std::tie(right.batch.created_at, right.batch.batch_id);
              });
    for (auto& sealed : sealed_batches) {
        static_cast<void>(
            publish_sealed(sealed, handoff_directory_, checkpoints_, recovered_at));
        ++report.published_batches;
    }

    // A manifest without its sealed batch is not a state produced by the
    // manifest-first cleanup protocol; fail closed instead of guessing.
    for (std::filesystem::directory_iterator iterator{outbox_directory_, error}, end;
         !error && iterator != end; iterator.increment(error)) {
        if (iterator->is_regular_file(error) && !error &&
            ends_with(iterator->path(), manifest_suffix)) {
            throw std::runtime_error{"orphaned outbox manifest without sealed batch"};
        }
    }
    if (error) {
        throw std::runtime_error{"cannot verify recovered outbox: " + error.message()};
    }
    return report;
}

OutboxUsage OutboxPublisher::usage() const {
    std::lock_guard lock{mutex_};
    return inspect_usage(outbox_directory_);
}

} // namespace trivikrama::collector::durability
