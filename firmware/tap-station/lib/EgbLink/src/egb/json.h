// Builds one JSON line in a fixed buffer, with no heap and no printf: the receiver's one writer for every line it
// sends the Pi. A line that would overflow the buffer is marked and comes out empty, so it is dropped whole.
//
//   json.begin("tap").str("st", "e4ba70").u32("id", 5).hex("uid", uid, 7).end()  ->  {"ev":"tap",...}\n
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "hex.h"

namespace egb {

class Json {
 public:
  Json(char *buf, size_t cap) : buf_(buf), cap_(cap) {}

  Json &begin(const char *ev) {
    len_ = 0;
    over_ = false;
    comma_ = false;
    put('{');
    return str("ev", ev);
  }

  Json &str(const char *k, const char *v) { return str(k, v, len(v)); }
  Json &str(const char *k, const char *v, size_t n) {
    key(k);
    put('"');
    for (size_t i = 0; i < n; i++) esc(v[i]);
    put('"');
    return value();
  }
  Json &hex(const char *k, const uint8_t *b, size_t n) {
    key(k);
    put('"');
    if (room(2 * n)) len_ += hexOut(buf_ + len_, b, n);
    put('"');
    return value();
  }
  Json &u32(const char *k, uint32_t v) {
    key(k);
    num(v);
    return value();
  }
  Json &i32(const char *k, int32_t v) {
    key(k);
    if (v < 0) put('-');
    num(v < 0 ? (uint32_t)(-(int64_t)v) : (uint32_t)v);
    return value();
  }
  Json &boolean(const char *k, bool v) {
    key(k);
    raw(v ? "true" : "false");
    return value();
  }
  Json &null(const char *k) {
    key(k);
    raw("null");
    return value();
  }

  // Nesting: `k` opens a keyed array/object; nullptr opens one as an array element.
  Json &arr(const char *k) { return open(k, '['); }
  Json &obj(const char *k = nullptr) { return open(k, '{'); }
  Json &close(char c) {
    put(c);
    return value();
  }

  // Finishes the line: its text and length, or length 0 when it overflowed.
  size_t end() {
    put('}');
    put('\n');
    return over_ ? 0 : len_;
  }
  const char *text() const { return buf_; }

 private:
  char *buf_;
  size_t cap_, len_ = 0;
  bool over_ = false, comma_ = false;

  static size_t len(const char *s) {
    size_t n = 0;
    while (s[n]) n++;
    return n;
  }
  bool room(size_t n) {
    if (over_ || len_ + n > cap_) over_ = true;
    return !over_;
  }
  void put(char c) {
    if (room(1)) buf_[len_++] = c;
  }
  void raw(const char *s) {
    while (*s) put(*s++);
  }
  void esc(char c) {
    unsigned char u = (unsigned char)c;
    if (c == '"' || c == '\\') {
      put('\\');
      put(c);
    } else if (u < 0x20) {
      static const char D[] = "0123456789abcdef";
      raw("\\u00");
      put(D[u >> 4]);
      put(D[u & 15]);
    } else {
      put(c);
    }
  }
  void num(uint32_t v) {
    char d[10];
    int n = 0;
    do {
      d[n++] = (char)('0' + v % 10);
      v /= 10;
    } while (v);
    while (n) put(d[--n]);
  }
  void key(const char *k) {
    if (comma_) put(',');
    comma_ = false;
    if (!k) return;
    put('"');
    raw(k);
    put('"');
    put(':');
  }
  Json &value() {
    comma_ = true;
    return *this;
  }
  Json &open(const char *k, char c) {
    key(k);
    put(c);
    comma_ = false;
    return *this;
  }
};

}  // namespace egb
