// Hex both ways: upper case out, either case in.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace egb {

// `n` bytes as 2n upper-case digits (no NUL); returns 2n.
inline size_t hexOut(char *out, const uint8_t *b, size_t n) {
  static const char D[] = "0123456789ABCDEF";
  for (size_t i = 0; i < n; i++) {
    out[2 * i] = D[b[i] >> 4];
    out[2 * i + 1] = D[b[i] & 15];
  }
  return 2 * n;
}

inline int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// `len` hex digits into at most `max` bytes: how many bytes, or -1 if it isn't whole hex bytes that fit.
inline int hexIn(const char *hex, size_t len, uint8_t *out, size_t max) {
  if (len % 2 || len / 2 > max) return -1;
  for (size_t i = 0; i < len / 2; i++) {
    int hi = hexNibble(hex[2 * i]), lo = hexNibble(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return -1;
    out[i] = (uint8_t)(hi << 4 | lo);
  }
  return (int)(len / 2);
}

}  // namespace egb
