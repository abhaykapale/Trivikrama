#include "trivikrama/collector/durability/checkpoint_store.hpp"

#include "trivikrama/collector/contract/serialization.hpp"
#include "trivikrama/collector/durability/durable_file.hpp"

#include <algorithm>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace trivikrama::collector::durability {
namespace {

constexpr std::size_t maximum_checkpoint_bytes = 1024U * 1024U;

void require_keys(const contract::Json& value, const std::string_view path,
                  const std::initializer_list<std::string_view> required) {
    if (!value.is_object()) {
        throw std::runtime_error{std::string{path} + " must be an object"};
    }
    for (const auto key : required) {
        if (!value.contains(std::string{key})) {
            throw std::runtime_error{std::string{path} + " is missing " + std::string{key}};
        }
    }
    for (const auto& [key, unused] : value.items()) {
        static_cast<void>(unused);
        if (std::none_of(required.begin(), required.end(),
                         [&key](const std::string_view expected) { return key == expected; })) {
            throw std::runtime_error{std::string{path} + " contains unknown field " + key};
        }
    }
}

[[nodiscard]] std::string required_string(const contract::Json& value,
                                          const std::string_view key) {
    const auto& field = value.at(std::string{key});
    if (!field.is_string() || field.get_ref<const std::string&>().empty()) {
        throw std::runtime_error{"checkpoint string field is invalid: " + std::string{key}};
    }
    return field.get<std::string>();
}

void validate_checkpoint_identity(const std::string& collector_id,
                                  const std::string& publication_id,
                                  const std::string& timestamp) {
    contract::EventBatch probe;
    probe.batch_id = publication_id;
    probe.collector_id = collector_id;
    probe.created_at = timestamp;
    probe.integrity.key_id = "checkpoint-validation";
    static_cast<void>(contract::serialize(probe, false));
}

[[nodiscard]] bool regresses_file_position(const contract::Json& previous,
                                           const contract::Json& next) {
    constexpr std::string_view identity{"file_identity"};
    constexpr std::string_view offset{"end_offset"};
    if (!previous.contains(std::string{identity}) ||
        !next.contains(std::string{identity}) ||
        !previous.contains(std::string{offset}) || !next.contains(std::string{offset}) ||
        !previous.at(std::string{identity}).is_string() ||
        !next.at(std::string{identity}).is_string() ||
        !previous.at(std::string{offset}).is_number_unsigned() ||
        !next.at(std::string{offset}).is_number_unsigned()) {
        return false;
    }
    return previous.at(std::string{identity}).get<std::string>() ==
               next.at(std::string{identity}).get<std::string>() &&
           next.at(std::string{offset}).get<std::uint64_t>() <
               previous.at(std::string{offset}).get<std::uint64_t>();
}

[[nodiscard]] std::string_view to_string(const CheckpointPublicationKind kind) noexcept {
    return kind == CheckpointPublicationKind::event_batch ? "event_batch" : "rejected_event";
}

[[nodiscard]] CheckpointPublicationKind parse_kind(const std::string& value) {
    if (value == "event_batch") {
        return CheckpointPublicationKind::event_batch;
    }
    if (value == "rejected_event") {
        return CheckpointPublicationKind::rejected_event;
    }
    throw std::runtime_error{"checkpoint publication kind is invalid"};
}

[[nodiscard]] CheckpointState parse_checkpoint(const std::string_view encoded) {
    const auto document = contract::parse_json_strict(encoded);
    require_keys(document, "$",
                 {"version", "collector_id", "updated_at", "last_publication_kind",
                  "last_publication_id", "sources"});
    if (!document.at("version").is_number_unsigned() ||
        document.at("version").get<std::uint64_t>() != 1U) {
        throw std::runtime_error{"checkpoint version must be 1"};
    }
    if (!document.at("sources").is_object()) {
        throw std::runtime_error{"checkpoint sources must be an object"};
    }
    CheckpointState state{required_string(document, "collector_id"),
                          required_string(document, "updated_at"),
                          parse_kind(required_string(document, "last_publication_kind")),
                          required_string(document, "last_publication_id"), {}};
    validate_checkpoint_identity(state.collector_id, state.last_publication_id,
                                 state.updated_at);
    for (const auto& [source_id, position] : document.at("sources").items()) {
        if (source_id.empty() || !position.is_object() || position.empty()) {
            throw std::runtime_error{"checkpoint source position is invalid"};
        }
        state.sources.emplace(source_id, position);
    }
    return state;
}

} // namespace

CheckpointStore::CheckpointStore(std::filesystem::path path) : path_{std::move(path)} {
    if (path_.empty()) {
        throw std::invalid_argument{"checkpoint path must not be empty"};
    }
}

std::optional<CheckpointState> CheckpointStore::load() const {
    std::lock_guard lock{mutex_};
    std::error_code error;
    const auto exists = std::filesystem::exists(path_, error);
    if (error) {
        throw std::runtime_error{"cannot inspect checkpoint: " + error.message()};
    }
    if (!exists) {
        return std::nullopt;
    }
    return parse_checkpoint(read_file_bounded(path_, maximum_checkpoint_bytes));
}

void CheckpointStore::commit(const std::string& collector_id,
                             const CheckpointPublicationKind publication_kind,
                             const std::string& publication_id,
                             const std::string& committed_at,
                             const SourcePositions& positions) {
    if (collector_id.empty() || publication_id.empty() || committed_at.empty() ||
        positions.empty()) {
        throw std::invalid_argument{"checkpoint commit fields must not be empty"};
    }
    validate_checkpoint_identity(collector_id, publication_id, committed_at);
    std::lock_guard lock{mutex_};
    SourcePositions merged;
    std::error_code error;
    const auto exists = std::filesystem::exists(path_, error);
    if (error) {
        throw std::runtime_error{"cannot inspect checkpoint: " + error.message()};
    }
    if (exists) {
        auto existing = parse_checkpoint(read_file_bounded(path_, maximum_checkpoint_bytes));
        if (existing.collector_id != collector_id) {
            throw std::runtime_error{"checkpoint belongs to a different collector"};
        }
        merged = std::move(existing.sources);
    }
    for (const auto& [source_id, position] : positions) {
        if (source_id.empty() || !position.is_object() || position.empty()) {
            throw std::invalid_argument{"source positions must be nonempty objects"};
        }
        const auto previous = merged.find(source_id);
        if (previous != merged.end() && regresses_file_position(previous->second, position)) {
            throw std::runtime_error{"checkpoint file offset regression for source " +
                                     source_id};
        }
        merged[source_id] = position;
    }

    contract::Json sources = contract::Json::object();
    for (const auto& [source_id, position] : merged) {
        sources[source_id] = position;
    }
    const contract::Json document{{"version", 1U},
                                  {"collector_id", collector_id},
                                  {"updated_at", committed_at},
                                  {"last_publication_kind",
                                   std::string{to_string(publication_kind)}},
                                  {"last_publication_id", publication_id},
                                  {"sources", std::move(sources)}};
    const auto encoded = document.dump();
    if (encoded.size() > maximum_checkpoint_bytes) {
        throw std::runtime_error{"checkpoint exceeds the 1 MiB limit"};
    }
    auto temporary = path_;
    temporary += ".tmp";
    write_file_durable(temporary, encoded);
    rename_durable(temporary, path_, true);
}

} // namespace trivikrama::collector::durability
