#include "trivikrama/collector/durability/checkpoint_store.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <filesystem>
#include <string>

namespace trivikrama::collector::durability {
namespace {

class TemporaryDirectory final {
  public:
    TemporaryDirectory()
        : path_{std::filesystem::temp_directory_path() /
                ("trivikrama-checkpoint-" +
                 std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()))} {
        std::filesystem::create_directories(path_);
    }
    ~TemporaryDirectory() { std::filesystem::remove_all(path_); }
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::filesystem::path path_;
};

TEST(CheckpointStore, AtomicallyMergesSourcePositions) {
    const TemporaryDirectory temporary;
    CheckpointStore store{temporary.path() / "checkpoint.json"};
    EXPECT_FALSE(store.load().has_value());

    store.commit("collector-01", CheckpointPublicationKind::event_batch,
                 "123e4567-e89b-42d3-a456-426614174000",
                 "2026-10-03T00:00:00Z",
                 {{"source-a", contract::Json{{"end_offset", 10U}}}});
    store.commit("collector-01", CheckpointPublicationKind::event_batch,
                 "123e4567-e89b-42d3-a456-426614174001",
                 "2026-10-03T00:00:01Z",
                 {{"source-b", contract::Json{{"end_offset", 20U}}}});

    const auto loaded = store.load();
    ASSERT_TRUE(loaded.has_value());
    EXPECT_EQ(loaded->last_publication_id, "123e4567-e89b-42d3-a456-426614174001");
    EXPECT_EQ(loaded->sources.size(), 2U);
    EXPECT_FALSE(std::filesystem::exists(store.path().string() + ".tmp"));
}

TEST(CheckpointStore, RejectsACollectorIdentityChange) {
    const TemporaryDirectory temporary;
    CheckpointStore store{temporary.path() / "checkpoint.json"};
    store.commit("collector-01", CheckpointPublicationKind::event_batch,
                 "123e4567-e89b-42d3-a456-426614174000",
                 "2026-10-03T00:00:00Z",
                 {{"source-a", contract::Json{{"end_offset", 10U}}}});
    EXPECT_THROW(store.commit("collector-02", CheckpointPublicationKind::event_batch,
                              "123e4567-e89b-42d3-a456-426614174001",
                              "2026-10-03T00:00:01Z",
                              {{"source-a", contract::Json{{"end_offset", 20U}}}}),
                 std::runtime_error);
}

} // namespace
} // namespace trivikrama::collector::durability
