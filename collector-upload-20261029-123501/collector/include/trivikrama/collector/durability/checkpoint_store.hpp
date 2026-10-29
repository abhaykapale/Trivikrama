#pragma once

#include "trivikrama/collector/contract/domain_types.hpp"

#include <filesystem>
#include <map>
#include <mutex>
#include <optional>
#include <string>

namespace trivikrama::collector::durability {

using SourcePositions = std::map<std::string, contract::Json, std::less<>>;

enum class CheckpointPublicationKind {
    event_batch,
    rejected_event,
};

struct CheckpointState final {
    std::string collector_id;
    std::string updated_at;
    CheckpointPublicationKind last_publication_kind{CheckpointPublicationKind::event_batch};
    std::string last_publication_id;
    SourcePositions sources;
};

class CheckpointWriter {
  public:
    virtual ~CheckpointWriter() = default;
    [[nodiscard]] virtual std::optional<CheckpointState> load() const = 0;
    virtual void commit(const std::string& collector_id,
                        CheckpointPublicationKind publication_kind,
                        const std::string& publication_id,
                        const std::string& committed_at,
                        const SourcePositions& positions) = 0;
};

class CheckpointStore final : public CheckpointWriter {
  public:
    explicit CheckpointStore(std::filesystem::path path);

    [[nodiscard]] std::optional<CheckpointState> load() const override;
    void commit(const std::string& collector_id,
                CheckpointPublicationKind publication_kind,
                const std::string& publication_id,
                const std::string& committed_at,
                const SourcePositions& positions) override;

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::filesystem::path path_;
    mutable std::mutex mutex_;
};

} // namespace trivikrama::collector::durability
