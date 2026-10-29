function(collector_set_project_warnings target warnings_as_errors)
  if(MSVC)
    set(warnings /W4 /permissive- /Zc:__cplusplus)
    if(warnings_as_errors)
      list(APPEND warnings /WX)
    endif()
  else()
    set(warnings
      -Wall
      -Wextra
      -Wpedantic
      -Wconversion
      -Wsign-conversion
      -Wshadow
      -Wformat=2
      -Wnull-dereference
      -Wdouble-promotion
    )
    if(warnings_as_errors)
      list(APPEND warnings -Werror)
    endif()
  endif()

  target_compile_options(${target} PRIVATE ${warnings})
endfunction()

