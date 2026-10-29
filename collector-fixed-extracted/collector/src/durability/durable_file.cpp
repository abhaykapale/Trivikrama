#include "trivikrama/collector/durability/durable_file.hpp"

#include <algorithm>
#include <cerrno>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <system_error>
#include <utility>

#ifdef _WIN32
#define NOMINMAX
#include <Windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace trivikrama::collector::durability {
namespace {

[[noreturn]] void fail(std::string operation, const std::filesystem::path& path,
                       std::string message) {
    throw DurableFileError{std::move(operation), path, std::move(message)};
}

#ifndef _WIN32
class FileDescriptor final {
  public:
    explicit FileDescriptor(const int value) : value_{value} {}
    ~FileDescriptor() {
        if (value_ >= 0) {
            static_cast<void>(::close(value_));
        }
    }
    FileDescriptor(const FileDescriptor&) = delete;
    FileDescriptor& operator=(const FileDescriptor&) = delete;
    [[nodiscard]] int get() const noexcept { return value_; }

  private:
    int value_;
};

void sync_directory(const std::filesystem::path& directory) {
    const auto descriptor = ::open(directory.c_str(), O_RDONLY | O_CLOEXEC | O_DIRECTORY);
    if (descriptor < 0) {
        fail("open_directory", directory, std::strerror(errno));
    }
    const FileDescriptor guard{descriptor};
    if (::fsync(descriptor) != 0) {
        fail("sync_directory", directory, std::strerror(errno));
    }
}
#endif

} // namespace

DurableFileError::DurableFileError(std::string operation, std::filesystem::path path,
                                   std::string message)
    : std::runtime_error{operation + " failed for " + path.string() + ": " + message},
      operation_{std::move(operation)}, path_{std::move(path)} {}

void write_file_durable(const std::filesystem::path& path, const std::string_view contents) {
#ifdef _WIN32
    const auto handle = ::CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                      FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        fail("open", path, "CreateFileW returned an error");
    }
    struct HandleGuard final {
        HANDLE value;
        ~HandleGuard() { static_cast<void>(::CloseHandle(value)); }
    } guard{handle};
    std::size_t offset = 0U;
    while (offset < contents.size()) {
        const auto remaining = contents.size() - offset;
        const auto chunk = static_cast<DWORD>(
            std::min<std::size_t>(remaining, static_cast<std::size_t>(MAXDWORD)));
        DWORD written{};
        if (::WriteFile(handle, contents.data() + offset, chunk, &written, nullptr) == 0 ||
            written != chunk) {
            fail("write", path, "WriteFile returned an error");
        }
        offset += static_cast<std::size_t>(written);
    }
    if (::FlushFileBuffers(handle) == 0) {
        fail("sync", path, "FlushFileBuffers returned an error");
    }
#else
    const auto descriptor = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (descriptor < 0) {
        fail("open", path, std::strerror(errno));
    }
    const FileDescriptor guard{descriptor};
    std::size_t offset = 0U;
    while (offset < contents.size()) {
        const auto written =
            ::write(descriptor, contents.data() + offset, contents.size() - offset);
        if (written < 0) {
            if (errno == EINTR) {
                continue;
            }
            fail("write", path, std::strerror(errno));
        }
        if (written == 0) {
            fail("write", path, "write made no progress");
        }
        offset += static_cast<std::size_t>(written);
    }
    if (::fsync(descriptor) != 0) {
        fail("sync", path, std::strerror(errno));
    }
#endif
}

void rename_durable(const std::filesystem::path& source,
                    const std::filesystem::path& destination,
                    const bool replace_destination) {
#ifdef _WIN32
    DWORD flags = MOVEFILE_WRITE_THROUGH;
    if (replace_destination) {
        flags |= MOVEFILE_REPLACE_EXISTING;
    }
    if (::MoveFileExW(source.c_str(), destination.c_str(), flags) == 0) {
        fail("rename", destination, "MoveFileExW returned an error");
    }
#else
    if (replace_destination) {
        if (::rename(source.c_str(), destination.c_str()) != 0) {
            fail("rename", destination, std::strerror(errno));
        }
        sync_directory(destination.parent_path());
        return;
    }

    // link(2) gives us an atomic, no-replace publication primitive on the same
    // filesystem. A preflight exists() check followed by rename() would race and
    // could overwrite another immutable batch.
    if (::link(source.c_str(), destination.c_str()) != 0) {
        fail("rename", destination, std::strerror(errno));
    }
    sync_directory(destination.parent_path());
    if (::unlink(source.c_str()) != 0) {
        fail("remove_source", source, std::strerror(errno));
    }
    if (source.parent_path() != destination.parent_path()) {
        sync_directory(source.parent_path());
    }
#endif
}

void remove_file_durable(const std::filesystem::path& path) {
    std::error_code error;
    if (!std::filesystem::exists(path, error)) {
        return;
    }
    if (!std::filesystem::remove(path, error) || error) {
        fail("remove", path, error.message());
    }
#ifndef _WIN32
    sync_directory(path.parent_path());
#endif
}

std::string read_file_bounded(const std::filesystem::path& path,
                              const std::size_t maximum_bytes) {
    std::error_code error;
    const auto size = std::filesystem::file_size(path, error);
    if (error || size > maximum_bytes) {
        fail("read", path, "file is inaccessible or exceeds the size limit");
    }
    std::ifstream input{path, std::ios::binary};
    if (!input) {
        fail("read", path, "cannot open file");
    }
    std::string value{std::istreambuf_iterator<char>{input}, std::istreambuf_iterator<char>{}};
    if (!input.eof() && input.fail()) {
        fail("read", path, "stream read failed");
    }
    return value;
}

} // namespace trivikrama::collector::durability
