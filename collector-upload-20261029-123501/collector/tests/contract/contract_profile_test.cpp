#include "trivikrama/collector/contract/contract_profile.hpp"

#include <gtest/gtest.h>

namespace trivikrama::collector::contract {

TEST(ContractProfile, FreezesApprovedVersionsAndMessageTypes) {
    EXPECT_EQ(ContractProfile::contract_version, "1.0.0");
    EXPECT_EQ(ContractProfile::ocsf_schema_version, "1.1.0");
    EXPECT_EQ(ContractProfile::event_batch_message_type, "event_batch");
    EXPECT_EQ(ContractProfile::heartbeat_message_type, "heartbeat");
    EXPECT_EQ(ContractProfile::rejected_event_message_type, "rejected_event");
}

TEST(ContractProfile, FreezesApprovedSecurityContract) {
    EXPECT_EQ(ContractProfile::signature_algorithm, "HMAC-SHA256");
    EXPECT_EQ(ContractProfile::signing_domain, "TRIVIKRAMA-COLLECTOR-CONTRACT-V1\n");
    EXPECT_EQ(ContractProfile::encoded_secret_length, 64U);
    EXPECT_EQ(ContractProfile::decoded_secret_length, 48U);
    EXPECT_EQ(ContractProfile::encoded_signature_length, 43U);
}

TEST(ContractProfile, FreezesApprovedCapacityLimits) {
    EXPECT_EQ(ContractProfile::maximum_events_per_batch, 1'000U);
    EXPECT_EQ(ContractProfile::maximum_encoded_batch_bytes, 8U * 1024U * 1024U);
    EXPECT_EQ(ContractProfile::maximum_encoded_event_bytes, 512U * 1024U);
    EXPECT_EQ(ContractProfile::maximum_batch_dwell_time.count(), 5);
    EXPECT_EQ(ContractProfile::maximum_outbox_bytes, 10ULL * 1024ULL * 1024ULL * 1024ULL);
    EXPECT_EQ(ContractProfile::maximum_outbox_batches, 10'000U);
}

TEST(ContractProfile, AcceptsOnlyFrozenContractAndOcsfVersions) {
    EXPECT_TRUE(ContractProfile::is_supported_contract_version("1.0.0"));
    EXPECT_FALSE(ContractProfile::is_supported_contract_version("1.0.1"));
    EXPECT_TRUE(ContractProfile::is_supported_ocsf_version("1.1.0"));
    EXPECT_FALSE(ContractProfile::is_supported_ocsf_version("1.0.0"));
}

} // namespace trivikrama::collector::contract

