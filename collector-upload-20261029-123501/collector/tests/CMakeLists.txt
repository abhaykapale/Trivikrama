find_package(GTest CONFIG REQUIRED)

add_executable(collector_tests
  foundation_test.cpp
  contract/contract_profile_test.cpp
  contract/contract_fixture_test.cpp
  contract/serialization_test.cpp
  config/config_loader_test.cpp
  ingress/file_reader_test.cpp
  monitoring/heartbeat_publisher_test.cpp
  monitoring/operational_metrics_test.cpp
  monitoring/resource_probe_test.cpp
  ocsf/baseline_mapper_test.cpp
  pipeline/batch_assembler_test.cpp
  pipeline/bounded_event_queue_test.cpp
  durability/checkpoint_store_test.cpp
  durability/outbox_publisher_test.cpp
  durability/rejected_event_publisher_test.cpp
  security/canonical_json_test.cpp
  security/contract_signer_test.cpp
  pipeline/simulated_input_test.cpp
  runtime/collector_runtime_test.cpp
  runtime/identifier_generator_test.cpp
  security/payload_encoding_test.cpp
)

target_compile_features(collector_tests PRIVATE cxx_std_20)
target_link_libraries(
  collector_tests
  PRIVATE
    Trivikrama::CollectorCore
    GTest::gtest_main
)
target_compile_definitions(
  collector_tests
  PRIVATE
    COLLECTOR_CONTRACT_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/contract-v1"
    COLLECTOR_CONFIG_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/config"
    COLLECTOR_SAMPLE_DIR="${PROJECT_SOURCE_DIR}/samples"
    COLLECTOR_SIGNING_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures/signing-v1"
)
collector_set_project_warnings(collector_tests ${COLLECTOR_WARNINGS_AS_ERRORS})
collector_enable_sanitizers(collector_tests ${COLLECTOR_ENABLE_SANITIZERS})

include(GoogleTest)
gtest_discover_tests(collector_tests DISCOVERY_TIMEOUT 30)
