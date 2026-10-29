#include "trivikrama/collector/ingress/file_reader.hpp"
#include "trivikrama/collector/ocsf/baseline_mapper.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <variant>

namespace trivikrama::collector {
namespace {

class SampleClock final : public ingress::IUtcClock {
  public:
    [[nodiscard]] std::string now() const override { return "2026-08-29T12:47:00Z"; }
};

TEST(SimulatedInputPipelineTest, ReadsAndMapsEveryShippedAuthenticationEvent) {
    constexpr std::size_t expected_event_count = 6U;
    const SampleClock clock;
    ingress::FileReader reader{
        ingress::FileReaderOptions{
            "simulated_auth_input",
            std::filesystem::path{COLLECTOR_SAMPLE_DIR} / "simulated-auth.jsonl",
            config::StartPosition::oldest,
            "simulator-01",
            contract::ContractProfile::maximum_encoded_event_bytes,
            64U * 1024U},
        clock};
    const ocsf::BaselineMapper mapper;

    const auto read = reader.poll(10U);

    ASSERT_EQ(read.items.size(), expected_event_count);
    std::size_t mapped_count = 0U;
    for (const auto& item : read.items) {
        ASSERT_TRUE(std::holds_alternative<ingress::RawEvent>(item));
        const auto mapped = mapper.map(std::get<ingress::RawEvent>(item));
        ASSERT_TRUE(std::holds_alternative<contract::ContractEvent>(mapped));
        const auto& event = std::get<contract::ContractEvent>(mapped);
        EXPECT_EQ(event.source.adapter_type, "file");
        EXPECT_EQ(event.ocsf.at("class_uid"), 3002U);
        EXPECT_EQ(event.ocsf.at("metadata").at("version"), "1.1.0");
        ++mapped_count;
    }
    EXPECT_EQ(mapped_count, expected_event_count);
    EXPECT_FALSE(read.has_partial_record);
}

} // namespace
} // namespace trivikrama::collector
