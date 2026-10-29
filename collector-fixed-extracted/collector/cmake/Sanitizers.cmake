function(collector_enable_sanitizers target enabled)
  if(NOT enabled)
    return()
  endif()

  if(MSVC)
    message(WARNING "COLLECTOR_ENABLE_SANITIZERS is not configured for MSVC in COL-01A")
    return()
  endif()

  target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
  target_link_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
endfunction()

