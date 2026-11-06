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
// A normal frame's LEN is one byte (the TFI and up to 254 bytes); longer ones, such as an InDataExchange with a 253-
// to 255-byte APDU, go as extended frames (00 00 FF FF FF LENm LENl LCS), up to 265 bytes with the TFI.
constexpr size_t MAX_DATA = 264;
constexpr size_t MAX_FRAME = 1 + 8 + 1 + MAX_DATA + 2;  // ready byte, the longest header, TFI, data, DCS, 00

// The frame for `cmd` (without the TFI) into `out` (room for n + 11); returns its length, 0 if too long.
inline size_t build(const uint8_t *cmd, size_t n, uint8_t *out) {
  if (n > MAX_DATA) return 0;
  size_t len = n + 1, i = 0;
  out[i++] = 0x00;
  out[i++] = 0x00;
  out[i++] = 0xFF;
  if (len <= 255) {
    out[i++] = (uint8_t)len;
    out[i++] = (uint8_t)(~len + 1);
  } else {
    out[i++] = 0xFF;
    out[i++] = 0xFF;
    out[i++] = (uint8_t)(len >> 8);
    out[i++] = (uint8_t)len;
    out[i++] = (uint8_t)(~((len >> 8) + len) + 1);
  }
  uint8_t sum = HOST_TO_PN532;
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

// Where an answer's TFI sits and how long its LEN says it is (TFI and data), from its first bytes (ready byte first):
// false when they aren't a frame start or the length's checksum is wrong.
inline bool header(const uint8_t *b, size_t got, size_t &tfiAt, size_t &len) {
  if (got < 6 || b[1] != 0x00 || b[2] != 0x00 || b[3] != 0xFF) return false;
  if (b[4] == 0xFF && b[5] == 0xFF) {  // extended
    if (got < 9 || (uint8_t)(b[6] + b[7] + b[8]) != 0) return false;
    tfiAt = 9;
    len = (size_t)b[6] << 8 | b[7];
  } else {
    if ((uint8_t)(b[4] + b[5]) != 0) return false;
    tfiAt = 6;
    len = b[4];
  }
  return true;
}

// How many bytes the whole answer is (ready byte included), from its first 16; 0 when they aren't a frame start.
inline size_t fullLength(const uint8_t *b, size_t got) {
  size_t at, len;
  return header(b, got, at, len) ? at + len + 2 : 0;  // header, TFI and data, DCS, 00
}

// The answer to command `code`: its data (after D5 and code+1) copied to `out`; the data length, or -1 when the frame
// is broken, isn't that answer, or doesn't fit `max`.
inline int parse(const uint8_t *b, size_t got, uint8_t code, uint8_t *out, size_t max) {
  size_t at, len;
  if (!header(b, got, at, len) || len < 2 || at + len + 1 > got) return -1;
  if (b[at] != PN532_TO_HOST || b[at + 1] != (uint8_t)(code + 1)) return -1;
  uint8_t sum = 0;
  for (size_t i = at; i <= at + len; i++) sum = (uint8_t)(sum + b[i]);  // the data and DCS sum to 0
  if (sum) return -1;
  size_t n = len - 2;
  if (n > max) return -1;
  memcpy(out, b + at + 2, n);
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
