#pragma once

#include <cstddef>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <string_view>

namespace trivikrama::collector::durability {

class DurableFileError final : public std::runtime_error {
  public:
    DurableFileError(std::string operation, std::filesystem::path path, std::string message);

    [[nodiscard]] const std::string& operation() const noexcept { return operation_; }
    [[nodiscard]] const std::filesystem::path& path() const noexcept { return path_; }

  private:
    std::string operation_;
    std::filesystem::path path_;
};

void write_file_durable(const std::filesystem::path& path, std::string_view contents);
void rename_durable(const std::filesystem::path& source,
                    const std::filesystem::path& destination, bool replace_destination);
void remove_file_durable(const std::filesystem::path& path);
[[nodiscard]] std::string read_file_bounded(const std::filesystem::path& path,
                                            std::size_t maximum_bytes);

} // namespace trivikrama::collector::durability
