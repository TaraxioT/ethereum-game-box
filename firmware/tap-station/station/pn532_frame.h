// PN532 frames over I2C: building a command, checking the ACK, reading an answer and the chips InListPassiveTarget
// found. Plain C++, tested on the host. Every I2C read from the PN532 starts with its ready byte, so the buffers here
// hold that byte first.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "egb/wire.h"

namespace st {
namespace frame {

constexpr uint8_t HOST_TO_PN532 = 0xD4;
constexpr uint8_t PN532_TO_HOST = 0xD5;
constexpr size_t MAX_DATA = 254;  // a normal frame's LEN is one byte: 255 minus the TFI

// The frame for `cmd` (without the TFI) into `out` (room for n + 8); returns its length, 0 if too long.
inline size_t build(const uint8_t *cmd, size_t n, uint8_t *out) {
  if (n + 1 > 255) return 0;
  uint8_t len = (uint8_t)(n + 1), sum = HOST_TO_PN532;
  size_t i = 0;
  out[i++] = 0x00;
  out[i++] = 0x00;
  out[i++] = 0xFF;
  out[i++] = len;
  out[i++] = (uint8_t)(~len + 1);
  out[i++] = HOST_TO_PN532;
  for (size_t k = 0; k < n; k++) {
    out[i++] = cmd[k];
    sum = (uint8_t)(sum + cmd[k]);
  }
  out[i++] = (uint8_t)(~sum + 1);
  out[i++] = 0x00;
  return i;
}

// ready, 00 00 FF 00 FF 00
inline bool isAck(const uint8_t *b, size_t got) {
  static const uint8_t ACK[] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};
  return got >= 7 && !memcmp(b + 1, ACK, 6);
}

// How many bytes the whole answer is (ready byte included), from the first few; 0 when they aren't a frame start.
inline size_t fullLength(const uint8_t *b, size_t got) {
  if (got < 6 || b[1] != 0x00 || b[2] != 0x00 || b[3] != 0xFF) return 0;
  return (size_t)b[4] + 8;  // ready, 00 00 FF LEN LCS, LEN bytes, DCS, 00
}

// The answer to command `code`: its data (after D5 and code+1) copied to `out`; the data length, or -1 when the frame
// is broken, isn't that answer, or doesn't fit `max`.
inline int parse(const uint8_t *b, size_t got, uint8_t code, uint8_t *out, size_t max) {
  size_t full = fullLength(b, got);
  if (!full || full > got || full < 10) return -1;
  uint8_t len = b[4];
  if ((uint8_t)(len + b[5]) != 0 || b[6] != PN532_TO_HOST || b[7] != (uint8_t)(code + 1)) return -1;
  uint8_t sum = 0;
  for (size_t i = 6; i < 6 + (size_t)len + 1; i++) sum = (uint8_t)(sum + b[i]);  // the data and DCS sum to 0
  if (sum) return -1;
  size_t n = (size_t)len - 2;
  if (n > max) return -1;
  memcpy(out, b + 8, n);
  return (int)n;
}

// InListPassiveTarget's answer (NbTg, then per chip: Tg, SENS_RES(2), SEL_RES, NFCID length, NFCID, [ATS]) into up to
// `max` chips; how many. ISO-DEP chips come with their ATS when the PN532 sent RATS itself.
inline uint8_t targets(const uint8_t *r, size_t got, egb::Chip *out, uint8_t max) {
  if (got < 1) return 0;
  size_t i = 1;
  uint8_t n = 0;
  for (uint8_t k = 0; k < r[0] && k < max; k++) {
    if (i + 5 > got) break;
    egb::Chip &c = out[k];
    memset(&c, 0, sizeof c);
    c.atqa[0] = r[i + 1];
    c.atqa[1] = r[i + 2];
    c.sak = r[i + 3];
    c.uidLen = r[i + 4];
    i += 5;
    if (c.uidLen > egb::CHIP_UID_MAX || i + c.uidLen > got) break;
    memcpy(c.uid, r + i, c.uidLen);
    i += c.uidLen;
    if (c.isoDep() && i < got && r[i] >= 1) {
      size_t atsLen = (size_t)r[i] - 1;  // the length byte counts itself
      if (i + 1 + atsLen > got) break;
      c.atsLen = (uint8_t)(atsLen < egb::CHIP_ATS_MAX ? atsLen : egb::CHIP_ATS_MAX);
      memcpy(c.ats, r + i + 1, c.atsLen);
      i += 1 + atsLen;
    }
    n = (uint8_t)(k + 1);
  }
  return n;
}

}  // namespace frame
}  // namespace st
