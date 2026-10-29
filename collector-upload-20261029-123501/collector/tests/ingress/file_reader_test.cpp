#include "trivikrama/collector/ingress/file_reader.hpp"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <system_error>
#include <variant>

namespace trivikrama::collector::ingress {
namespace {

class FixedClock final : public IUtcClock {
  public:
    [[nodiscard]] std::string now() const override { return "2026-08-29T12:44:41Z"; }
};

class TemporaryInput final {
  public:
    TemporaryInput() {
        static std::atomic<unsigned long long> sequence{};
        const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
        root_ = std::filesystem::temp_directory_path() /
                ("trivikrama-reader-test-" + std::to_string(stamp) + "-" +
                 std::to_string(sequence.fetch_add(1U)));
        std::filesystem::create_directories(root_);
        path_ = root_ / "events.jsonl";
        write("");
    }

    ~TemporaryInput() {
        std::error_code ignored;
        std::filesystem::remove_all(root_, ignored);
    }

    TemporaryInput(const TemporaryInput&) = delete;
    TemporaryInput& operator=(const TemporaryInput&) = delete;

    void write(const std::string_view value) const {
        std::ofstream output{path_, std::ios::binary | std::ios::trunc};
        ASSERT_TRUE(output.good());
        output.write(value.data(), static_cast<std::streamsize>(value.size()));
        ASSERT_TRUE(output.good());
    }

    void append(const std::string_view value) const {
        std::ofstream output{path_, std::ios::binary | std::ios::app};
        ASSERT_TRUE(output.good());
        output.write(value.data(), static_cast<std::streamsize>(value.size()));
        ASSERT_TRUE(output.good());
    }

    void rotate(const std::string_view replacement) const {
        std::filesystem::rename(path_, root_ / "events.jsonl.1");
        write(replacement);
    }

    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::filesystem::path root_;
    std::filesystem::path path_;
};

[[nodiscard]] std::string event_line(const std::string_view id = "auth:000001") {
    return "{\"endpoint_id\":\"simulated-host-01\",\"event_id\":\"" + std::string{id} +
           "\",\"event_type\":\"login_failed\",\"source_ip\":\"192.0.2.10\","
           "\"timestamp\":\"2026-08-29T12:44:40Z\",\"username\":\"test-user\"}";
}

[[nodiscard]] FileReader make_reader(const TemporaryInput& input, const FixedClock& clock,
                                     const config::StartPosition start =
                                         config::StartPosition::oldest,
                                     const std::size_t maximum_record_bytes = 0U) {
    return FileReader{FileReaderOptions{"simulated_auth_input", input.path(), start,
                                        "simulator-01", maximum_record_bytes, 64U},
                      clock};
}

TEST(FileReaderTest, ReadsCompleteJsonLinesIncrementallyWithStablePositions) {
    TemporaryInput input;
    const auto first = event_line();
    const auto second = event_line("auth:000002");
    input.write(first + "\n" + second + "\n");
    const FixedClock clock;
    auto reader = make_reader(input, clock);

    const auto first_poll = reader.poll(1U);
    ASSERT_EQ(first_poll.items.size(), 1U);
    const auto& first_event = std::get<RawEvent>(first_poll.items.front());
    EXPECT_EQ(first_event.raw_payload, first);
    EXPECT_EQ(first_event.original_endpoint_id, "simulated-host-01");
    EXPECT_EQ(first_event.upstream_event_id, "auth:000001");
    EXPECT_EQ(first_event.received_time, "2026-08-29T12:44:41Z");
    EXPECT_EQ(first_event.position.at("record_start_offset"), 0U);
    EXPECT_EQ(first_event.position.at("record_end_offset"), first.size() + 1U);

    const auto second_poll = reader.poll(1U);
    ASSERT_EQ(second_poll.items.size(), 1U);
    const auto& second_event = std::get<RawEvent>(second_poll.items.front());
    EXPECT_EQ(second_event.upstream_event_id, "auth:000002");
    EXPECT_EQ(second_event.position.at("record_start_offset"), first.size() + 1U);
    EXPECT_FALSE(second_poll.has_partial_record);
}

TEST(FileReaderTest, BuffersIncompleteLineUntilNewlineArrives) {
    TemporaryInput input;
    const auto line = event_line();
    const auto split = line.size() / 2U;
    input.write(std::string_view{line}.substr(0U, split));
    const FixedClock clock;
    auto reader = make_reader(input, clock);

    const auto incomplete = reader.poll(10U);
    EXPECT_TRUE(incomplete.items.empty());
    EXPECT_TRUE(incomplete.has_partial_record);

    input.append(std::string_view{line}.substr(split));
    input.append("\n");
    const auto complete = reader.poll(10U);
    ASSERT_EQ(complete.items.size(), 1U);
    EXPECT_EQ(std::get<RawEvent>(complete.items.front()).raw_payload, line);
}

TEST(FileReaderTest, NewestStartsAfterExistingRecords) {
    TemporaryInput input;
    input.write(event_line() + "\n");
    const FixedClock clock;
    auto reader = make_reader(input, clock, config::StartPosition::newest);

    EXPECT_TRUE(reader.poll(10U).items.empty());
    input.append(event_line("auth:000002") + "\n");
    const auto result = reader.poll(10U);

    ASSERT_EQ(result.items.size(), 1U);
    EXPECT_EQ(std::get<RawEvent>(result.items.front()).upstream_event_id, "auth:000002");
}

TEST(FileReaderTest, RestartsAtBeginningAfterTruncationOrReplacement) {
    TemporaryInput input;
    input.write(event_line() + "\n");
    const FixedClock clock;
    auto reader = make_reader(input, clock);
    ASSERT_EQ(reader.poll(10U).items.size(), 1U);

    input.write(event_line("auth:truncated") + "\n");
    const auto truncated = reader.poll(10U);
    ASSERT_EQ(truncated.items.size(), 1U);
    EXPECT_EQ(std::get<RawEvent>(truncated.items.front()).upstream_event_id, "auth:truncated");

    input.rotate(event_line("auth:rotated") + "\n");
    const auto rotated = reader.poll(10U);
    ASSERT_EQ(rotated.items.size(), 1U);
    EXPECT_EQ(std::get<RawEvent>(rotated.items.front()).upstream_event_id, "auth:rotated");
}

TEST(FileReaderTest, ConvertsMalformedDuplicateAndMissingEnvelopeRecordsToRejections) {
    TemporaryInput input;
    input.write("not-json\n"
                "{\"event_id\":\"one\",\"event_id\":\"two\"}\n"
                "{\"endpoint_id\":\"host\",\"event_type\":\"login_failed\","
                "\"timestamp\":\"2026-08-29T12:44:40Z\"}\n");
    const FixedClock clock;
    auto reader = make_reader(input, clock);

    const auto result = reader.poll(10U);

    ASSERT_EQ(result.items.size(), 3U);
    EXPECT_EQ(std::get<InputRejection>(result.items[0]).code,
              contract::RejectionCode::invalid_json);
    EXPECT_EQ(std::get<InputRejection>(result.items[1]).code,
              contract::RejectionCode::invalid_json);
    EXPECT_EQ(std::get<InputRejection>(result.items[2]).code,
              contract::RejectionCode::missing_required_field);
    EXPECT_EQ(std::get<InputRejection>(result.items[0]).payload_sha256,
              security::sha256_hex("not-json"));
}

TEST(FileReaderTest, RejectsInvalidUtf8AndOversizedRecords) {
    TemporaryInput input;
    auto invalid_utf8 = event_line();
    invalid_utf8.insert(invalid_utf8.size() - 1U, std::string{"\xC3\x28", 2U});
    input.write(invalid_utf8 + "\n" + std::string(100U, 'x') + "\n");
    const FixedClock clock;
    auto reader = make_reader(input, clock, config::StartPosition::oldest, 32U);

    const auto result = reader.poll(10U);

    ASSERT_EQ(result.items.size(), 2U);
    EXPECT_EQ(std::get<InputRejection>(result.items[0]).code,
              contract::RejectionCode::record_too_large);
    EXPECT_EQ(std::get<InputRejection>(result.items[1]).code,
              contract::RejectionCode::record_too_large);
    EXPECT_TRUE(std::get<InputRejection>(result.items[1]).capture_truncated);
}

TEST(FileReaderTest, DistinguishesInvalidUtf8WithinTheConfiguredLimit) {
    TemporaryInput input;
    std::string invalid{"{\"endpoint_id\":\""};
    invalid.append("\xC3\x28", 2U);
    invalid += "\",\"event_id\":\"one\",\"event_type\":\"login_failed\","
               "\"timestamp\":\"2026-08-29T12:44:40Z\"}\n";
    input.write(invalid);
    const FixedClock clock;
    auto reader = make_reader(input, clock);

    const auto result = reader.poll(10U);

    ASSERT_EQ(result.items.size(), 1U);
    EXPECT_EQ(std::get<InputRejection>(result.items.front()).code,
              contract::RejectionCode::invalid_utf8);
}

} // namespace
} // namespace trivikrama::collector::ingress
