cmake_minimum_required(VERSION 3.25)

if(NOT DEFINED CMAKE_TOOLCHAIN_FILE AND DEFINED ENV{VCPKG_ROOT})
  set(
    CMAKE_TOOLCHAIN_FILE
    "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
    CACHE FILEPATH "vcpkg toolchain file"
  )
endif()

project(
  trivikrama_collector
  VERSION 0.8.0
  DESCRIPTION "Trivikrama central security-event Collector"
  LANGUAGES CXX
)

include(CTest)
include(GNUInstallDirs)

option(COLLECTOR_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" ON)
option(COLLECTOR_ENABLE_SANITIZERS "Enable supported address/undefined sanitizers" OFF)
option(COLLECTOR_ENABLE_CLANG_TIDY "Run clang-tidy while compiling" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(CompilerWarnings)
include(Sanitizers)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(yaml-cpp CONFIG REQUIRED)

if(COLLECTOR_ENABLE_CLANG_TIDY)
  find_program(CLANG_TIDY_EXECUTABLE NAMES clang-tidy REQUIRED)
  set(CMAKE_CXX_CLANG_TIDY "${CLANG_TIDY_EXECUTABLE}")
endif()

add_library(collector_core STATIC
  src/config/config.cpp
  src/config/config_loader.cpp
  src/contract/contract_profile.cpp
  src/contract/serialization.cpp
  src/durability/checkpoint_store.cpp
  src/durability/durable_file.cpp
  src/durability/outbox_publisher.cpp
  src/durability/rejected_event_publisher.cpp
  src/ingress/file_reader.cpp
  src/monitoring/heartbeat_publisher.cpp
  src/monitoring/operational_metrics.cpp
  src/monitoring/resource_probe.cpp
  src/ocsf/baseline_mapper.cpp
  src/pipeline/batch_assembler.cpp
  src/pipeline/bounded_event_queue.cpp
  src/runtime/identifier_generator.cpp
  src/runtime/collector_runtime.cpp
  src/security/canonical_json.cpp
  src/security/contract_signer.cpp
  src/security/payload_encoding.cpp
)
add_library(Trivikrama::CollectorCore ALIAS collector_core)

target_compile_features(collector_core PUBLIC cxx_std_20)
target_link_libraries(
  collector_core
  PUBLIC
    nlohmann_json::nlohmann_json
    OpenSSL::Crypto
    yaml-cpp::yaml-cpp
)
target_include_directories(
  collector_core
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
collector_set_project_warnings(collector_core ${COLLECTOR_WARNINGS_AS_ERRORS})
collector_enable_sanitizers(collector_core ${COLLECTOR_ENABLE_SANITIZERS})

if(WIN32)
  target_link_libraries(collector_core PRIVATE psapi ws2_32)
endif()

add_executable(collector src/app/main.cpp)
target_compile_features(collector PRIVATE cxx_std_20)
target_link_libraries(collector PRIVATE Trivikrama::CollectorCore)
collector_set_project_warnings(collector ${COLLECTOR_WARNINGS_AS_ERRORS})
collector_enable_sanitizers(collector ${COLLECTOR_ENABLE_SANITIZERS})

if(BUILD_TESTING)
  add_subdirectory(tests)
  add_custom_target(
    run_tests
    COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
    DEPENDS collector_tests
    USES_TERMINAL
  )
endif()

file(GLOB_RECURSE COLLECTOR_FORMAT_FILES CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/include/*.hpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp"
)
find_program(CLANG_FORMAT_EXECUTABLE NAMES clang-format)
if(CLANG_FORMAT_EXECUTABLE)
  add_custom_target(
    format
    COMMAND ${CLANG_FORMAT_EXECUTABLE} -i ${COLLECTOR_FORMAT_FILES}
    COMMENT "Formatting Collector C++ sources"
    VERBATIM
  )
else()
  add_custom_target(
    format
    COMMAND ${CMAKE_COMMAND} -E echo "clang-format is required for the format target"
    COMMAND ${CMAKE_COMMAND} -E false
    VERBATIM
  )
endif()

install(TARGETS collector RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
