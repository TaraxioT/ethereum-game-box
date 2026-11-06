// A small test harness for the host tests: CHECK records a failure and carries on; main() reports and exits non-zero.
#pragma once

#include <stdio.h>
#include <string.h>

#include <string>

namespace check {

inline int &failures() {
  static int n = 0;
  return n;
}
inline int &checks() {
  static int n = 0;
  return n;
}

struct Test {
  typedef void (*Fn)();
  const char *name;
  Fn fn;
  Test *next;
  static Test *&head() {
    static Test *h = nullptr;
    return h;
  }
  Test(const char *n, Fn f) : name(n), fn(f), next(head()) { head() = this; }
};

inline void fail(const char *file, int line, const std::string &what) {
  failures()++;
  fprintf(stderr, "  FAIL %s:%d: %s\n", file, line, what.c_str());
}

}  // namespace check

#define TEST(name)                                       \
  static void name();                                    \
  static check::Test name##_test(#name, name);           \
  static void name()

#define CHECK(cond)                                                       \
  do {                                                                    \
    check::checks()++;                                                    \
    if (!(cond)) check::fail(__FILE__, __LINE__, #cond);                  \
  } while (0)

#define CHECK_EQ(a, b)                                                                              \
  do {                                                                                              \
    check::checks()++;                                                                              \
    auto va_ = (a);                                                                                 \
    auto vb_ = (b);                                                                                 \
    if (!(va_ == vb_))                                                                              \
      check::fail(__FILE__, __LINE__, std::string(#a " == " #b " (") + std::to_string(va_) + " vs " + \
                                          std::to_string(vb_) + ")");                              \
  } while (0)

#define CHECK_STR(a, b)                                                                                    \
  do {                                                                                                     \
    check::checks()++;                                                                                     \
    std::string sa_ = (a), sb_ = (b);                                                                      \
    if (sa_ != sb_) check::fail(__FILE__, __LINE__, std::string(#a "\n    got:  ") + sa_ + "\n    want: " + sb_); \
  } while (0)
