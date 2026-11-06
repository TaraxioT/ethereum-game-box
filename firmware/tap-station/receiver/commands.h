// The Pi's command lines (protocol.md, "Commands"), parsed into a Command. Plain C++, tested on the host.
#pragma once

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "egb/config.h"
#include "egb/hex.h"
#include "egb/wire.h"

namespace rcv {

enum CmdType : uint8_t { C_STATE, C_PRESS, C_BUZZ, C_SCREEN, C_NFC, C_STATS };

// The command words, for egb::unglue.
static const char *const COMMAND_WORDS[] = {"state", "press", "buzz", "screen", "nfc", "stats"};
constexpr size_t COMMAND_COUNT = sizeof COMMAND_WORDS / sizeof COMMAND_WORDS[0];

struct Command {
  enum Result : uint8_t {
    OK,
    BAD_LINE,     // answered with `bad` (`why` says why)
    BAD_REQUEST,  // a known command with its station and id, the rest unusable: answered with <cmd>_fail
  } result;
  const char *why;
  CmdType type;
  char st[7];  // a station name (lower case), "all", or "" (stats of the receiver)
  uint32_t id;
  uint16_t ms;
  uint8_t pulses;
  uint8_t op;  // egb::NfcOp
  uint16_t len;
  uint8_t data[egb::APDU_MAX];  // nfc: the APDU or UID; screen: the payload
};

namespace detail {

// The next space-separated word: its start and length, `s` moved past it.
inline bool word(const char *&s, const char *&w, size_t &n) {
  while (*s == ' ') s++;
  w = s;
  while (*s && *s != ' ') s++;
  n = (size_t)(s - w);
  return n > 0;
}

inline bool is(const char *w, size_t n, const char *name) { return strlen(name) == n && !memcmp(w, name, n); }

inline bool decimal(const char *w, size_t n, uint32_t lo, uint32_t hi, uint32_t &out) {
  if (!n || n > 10) return false;
  uint64_t v = 0;
  for (size_t i = 0; i < n; i++) {
    if (w[i] < '0' || w[i] > '9') return false;
    v = v * 10 + (uint64_t)(w[i] - '0');
  }
  if (v < lo || v > hi) return false;
  out = (uint32_t)v;
  return true;
}

// A station name (six hex digits), or "all" where `all` allows it; stored lower case.
inline bool station(const char *w, size_t n, bool all, char out[7]) {
  if (all && is(w, n, "all")) {
    memcpy(out, "all", 4);
    return true;
  }
  if (n != 6) return false;
  for (size_t i = 0; i < 6; i++) {
    if (egb::hexNibble(w[i]) < 0) return false;
    out[i] = (char)(w[i] >= 'A' && w[i] <= 'F' ? w[i] - 'A' + 'a' : w[i]);
  }
  out[6] = 0;
  return true;
}

inline Command &bad(Command &c, const char *why) {
  c.result = Command::BAD_LINE;
  c.why = why;
  return c;
}

inline Command &badRequest(Command &c) {
  c.result = Command::BAD_REQUEST;
  c.why = "bad request";
  return c;
}

}  // namespace detail

// Parses one line (already ungled: see egb::unglue).
inline Command &parse(const char *line, Command &c) {
  using namespace detail;
  memset(&c, 0, sizeof c);
  c.result = Command::OK;
  const char *s = line, *w;
  size_t n;
  if (!word(s, w, n)) return bad(c, "empty line");
  bool hasSt;
  if (is(w, n, "state")) {
    c.type = C_STATE;
  } else if (is(w, n, "stats")) {
    c.type = C_STATS;
    if (word(s, w, n) && !station(w, n, false, c.st)) return bad(c, "bad station");
  } else if (is(w, n, "press")) {
    c.type = C_PRESS;
    if (!word(s, w, n) || !decimal(w, n, 1, UINT32_MAX, c.id)) return bad(c, "bad id");
  } else if ((hasSt = is(w, n, "buzz")) || is(w, n, "screen") || is(w, n, "nfc")) {
    c.type = hasSt ? C_BUZZ : is(w, n, "screen") ? C_SCREEN : C_NFC;
    if (!word(s, w, n) || !station(w, n, c.type != C_NFC, c.st)) return bad(c, "bad station");
    if (!word(s, w, n) || !decimal(w, n, 1, UINT32_MAX, c.id)) return bad(c, "bad id");
    if (c.type == C_BUZZ) {
      uint32_t v = egb::BUZZ_MS_DEFAULT;
      if (word(s, w, n) && !decimal(w, n, 1, egb::BUZZ_MS_MAX, v)) return badRequest(c);
      c.ms = (uint16_t)v;
      v = 1;
      if (word(s, w, n) && !decimal(w, n, 1, egb::BUZZ_PULSES_MAX, v)) return badRequest(c);
      c.pulses = (uint8_t)v;
    } else if (c.type == C_SCREEN) {
      int got = word(s, w, n) ? egb::hexIn(w, n, c.data, egb::SCREEN_MAX) : -1;
      if (got < 1) return badRequest(c);
      c.len = (uint16_t)got;
    } else {
      static const char *const OPS[egb::OP_COUNT] = {"", "apdu", "sign", "reselect", "select", "list"};
      if (!word(s, w, n)) return badRequest(c);
      for (uint8_t k = egb::OP_APDU; k < egb::OP_COUNT; k++)
        if (is(w, n, OPS[k])) c.op = k;
      bool wantsHex = c.op == egb::OP_APDU || c.op == egb::OP_SIGN || c.op == egb::OP_SELECT;
      if (!c.op) return badRequest(c);
      if (wantsHex) {
        size_t max = c.op == egb::OP_SELECT ? egb::CHIP_UID_MAX : egb::APDU_MAX;
        int got = word(s, w, n) ? egb::hexIn(w, n, c.data, max) : -1;
        if (got < 1) return badRequest(c);
        c.len = (uint16_t)got;
      }
    }
  } else {
    return bad(c, "unknown command");
  }
  if (word(s, w, n)) {  // anything left over
    if (c.type == C_BUZZ || c.type == C_SCREEN || c.type == C_NFC) return badRequest(c);
    return bad(c, "bad request");
  }
  return c;
}

}  // namespace rcv
