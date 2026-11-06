// The Pi's screen for a station (protocol.md, "Screens"): `key=value` lines read into a ScreenSpec. Plain C++, tested
// on the host.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "feedback.h"

namespace st {

constexpr size_t TAG_MAX = 3;
constexpr size_t BIG_MAX = 10;
constexpr size_t SMALL_MAX = 20;
constexpr uint32_t TTL_MAX_S = 1000000;  // ~11 days is as good as for ever (and still fits in ms)

struct ScreenText {
  char big[BIG_MAX + 1];
  char small[SMALL_MAX + 1];
  bool given;  // false: the station's own text
};

// What a payload asks for; all zeros = nothing asked (every default).
struct ScreenSpec {
  char tag[TAG_MAX + 1];
  ScreenText idle;  // given: `big` was sent, even empty
  ScreenText feedback[FB_COUNT];
  uint32_t ttlS;  // 0: until the link drops
};

// Printable ASCII only (anything else shows as '?'), at most `max` characters; big text upper-cased.
inline void screenCopy(char *out, size_t max, const char *v, size_t n, bool upper) {
  size_t k = 0;
  for (size_t i = 0; i < n && k < max; i++) {
    char c = v[i];
    if (c < 0x20 || c > 0x7e) c = '?';
    if (upper && c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
    out[k++] = c;
  }
  out[k] = 0;
}

// Fills `s` from a payload. Unknown keys and lines without '=' are skipped, so the Pi can add keys with no reflash;
// a key sent twice keeps its last value.
inline void screenParse(const char *p, size_t len, ScreenSpec &s) {
  static const char *const FB_KEYS[FB_COUNT] = {"hold", "sign", "done", "fail"};
  memset(&s, 0, sizeof s);
  for (size_t i = 0; i < len;) {
    size_t end = i;
    while (end < len && p[end] != '\n') end++;
    const char *line = p + i;
    size_t n = end - i;
    i = end + 1;
    if (n && line[n - 1] == '\r') n--;
    const char *eq = (const char *)memchr(line, '=', n);
    if (!eq) continue;
    size_t kn = (size_t)(eq - line), vn = n - kn - 1;
    const char *v = eq + 1;
    auto is = [&](const char *name) { return strlen(name) == kn && !memcmp(line, name, kn); };
    if (is("tag")) {
      screenCopy(s.tag, TAG_MAX, v, vn, true);
    } else if (is("big")) {
      screenCopy(s.idle.big, BIG_MAX, v, vn, true);
      s.idle.given = true;
    } else if (is("small")) {
      screenCopy(s.idle.small, SMALL_MAX, v, vn, false);
    } else if (is("ttl")) {
      uint32_t ttl = 0;
      bool digits = vn > 0;
      for (size_t k = 0; k < vn && digits; k++) {
        if (v[k] < '0' || v[k] > '9') digits = false;
        else if ((ttl = ttl * 10 + (uint32_t)(v[k] - '0')) > TTL_MAX_S) ttl = TTL_MAX_S;
      }
      if (digits) s.ttlS = ttl;
    } else {
      for (int f = 0; f < FB_COUNT; f++) {
        if (!is(FB_KEYS[f])) continue;
        ScreenText &t = s.feedback[f];
        memset(&t, 0, sizeof t);
        if (!vn) break;  // empty: the default
        const char *bar = (const char *)memchr(v, '|', vn);  // BIG|small; no bar, no small line
        size_t bn = bar ? (size_t)(bar - v) : vn;
        screenCopy(t.big, BIG_MAX, v, bn, true);
        if (bar) screenCopy(t.small, SMALL_MAX, bar + 1, vn - bn - 1, false);
        t.given = true;
        break;
      }
    }
  }
}

}  // namespace st
