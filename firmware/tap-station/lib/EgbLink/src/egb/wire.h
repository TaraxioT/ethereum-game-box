// The radio packets between the stations and the receiver: one small packed struct per kind, each starting with the
// same four-byte head. Plain C++ (the host tests build and parse them too). Both ends run the same esp32 core, so
// ESP-NOW v2 carries up to 1470 bytes and the largest packet here (an NFC reply) fits in one.
//
// Who acks what:
//   Press  -> Ack       the LED switched (the ack carries the receiver's LED in its flags)
//   Tap, Gone, Signed, Buzz, Screen -> Got   took it (every copy is acked, so a lost Got is healed by the next resend)
//   NfcReq -> NfcRes    the station's answer (a resend of a finished request gets the same answer again)
//   StatsReq -> StatsRes
//   Ping -> Pong
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "config.h"

namespace egb {

constexpr uint8_t MAGIC = 0xE6;  // tells our packets from any other ESP-NOW traffic on the channel

enum Kind : uint8_t {
  K_PING = 1,     // station -> receiver, every PING_MS (broadcast until it knows the receiver)
  K_PONG,         // receiver -> station
  K_PRESS,        // either way: toggle your LED
  K_ACK,          // either way: took the press
  K_REPORT,       // station -> receiver: how its own press went
  K_RELEASE,      // either way: my button came up
  K_TAP,          // station -> receiver: a chip landed
  K_GONE,         // station -> receiver: that chip left
  K_SIGNED,       // station -> receiver: a sign request finished on the reader
  K_BUZZ,         // receiver -> station: run the motor
  K_GOT,          // either way: took that packet
  K_NFC_REQ,      // receiver -> station: a request for the reader
  K_NFC_RES,      // station -> receiver: its answer
  K_SCREEN,       // receiver -> station: the Pi's text for the OLED
  K_STATS_REQ,    // receiver -> station
  K_STATS_RES,    // station -> receiver
  K_COUNT
};

// Every packet carries its sender's state, so a lost packet that changed it heals with the next one.
constexpr uint8_t F_LED = 0x01;  // the sender's LED is on
constexpr uint8_t F_BTN = 0x02;  // the sender's BOOT is held
constexpr uint8_t F_NFC = 0x04;  // the station's PN532 answers
constexpr uint8_t F_RECEIVER = 0x80;  // sent by the receiver: a station ignores other stations' broadcasts

struct __attribute__((packed)) Head {
  uint8_t magic;
  uint8_t kind;
  uint8_t flags;
  uint8_t tries;  // which send this is (a resend slot sets it); acks echo it
};

// A chip as the PN532 reported it. The ATS is kept without its length byte.
struct __attribute__((packed)) Chip {
  uint8_t atqa[2];
  uint8_t sak;
  uint8_t uidLen;
  uint8_t uid[CHIP_UID_MAX];
  uint8_t atsLen;
  uint8_t ats[CHIP_ATS_MAX];

  bool isoDep() const { return sak & 0x20; }
  bool sameAs(const Chip &o) const { return uidLen == o.uidLen && uidLen <= CHIP_UID_MAX && !memcmp(uid, o.uid, uidLen); }
  // A chip read off the air has its lengths clamped before anything prints it.
  void clamp() {
    if (uidLen > CHIP_UID_MAX) uidLen = CHIP_UID_MAX;
    if (atsLen > CHIP_ATS_MAX) atsLen = CHIP_ATS_MAX;
  }
};

struct __attribute__((packed)) Ping {
  Head h;
  uint32_t seq;
  uint32_t t;      // the station's micros() at sending, echoed by the pong
  uint32_t rttUs;  // the station's last ping round trip
};

struct __attribute__((packed)) Pong {
  Head h;
  uint32_t seq;
  uint32_t t;
};

struct __attribute__((packed)) Press {
  Head h;
  uint32_t id;
  uint32_t t;  // the sender's micros() at the first send, echoed by the ack
};

struct __attribute__((packed)) Ack {
  Head h;
  uint32_t id;
  uint32_t t;
};

struct __attribute__((packed)) Report {
  Head h;
  uint32_t id;
  uint32_t rttUs;  // 0: never acked
  uint8_t sends;
};

struct __attribute__((packed)) Release {
  Head h;
};

struct __attribute__((packed)) Tap {
  Head h;
  uint32_t id;
  uint32_t readUs;  // from the start of the detection that found the chip until this left
  uint32_t gapUs;   // the detection before it: the chip landed in that window
  Chip chip;
};

struct __attribute__((packed)) Gone {
  Head h;
  uint32_t id;  // the tap's id
  Chip chip;
};

struct __attribute__((packed)) Signed {
  Head h;
  uint32_t id;   // the sign request's id
  uint32_t tap;  // the tap the chip came with
  uint32_t chipUs;
  uint32_t totalUs;
  uint8_t ok;
  Chip chip;
};

struct __attribute__((packed)) Buzz {
  Head h;
  uint32_t id;
  uint16_t ms;
  uint8_t pulses;
};

struct __attribute__((packed)) Got {
  Head h;
  uint8_t of;  // the kind it acks
  uint32_t id;
};

enum NfcOp : uint8_t { OP_APDU = 1, OP_SIGN, OP_RESELECT, OP_SELECT, OP_LIST, OP_COUNT };

enum NfcErr : uint8_t {
  ERR_OK = 0,
  ERR_NO_TAG = 1,     // no chip answered
  ERR_RF = 2,         // the PN532 reported an RF error (pn532 = its status byte; 255 = it timed out)
  ERR_NO_CHIP = 3,    // an APDU with no chip on the reader
  ERR_NO_READER = 4,  // the PN532 isn't answering
  ERR_BAD = 5,        // a bad request
};

struct __attribute__((packed)) NfcReq {
  Head h;
  uint32_t id;
  uint8_t op;
  uint16_t len;
  uint8_t data[APDU_MAX];  // the APDU, or the UID for select
};

struct __attribute__((packed)) NfcRes {
  Head h;
  uint32_t id;
  uint8_t op;
  uint8_t err;
  uint8_t pn532;
  uint16_t sel;  // reselect: the applet select's status word (0: none)
  uint32_t us;
  uint32_t waitUs;
  uint16_t len;
  uint8_t data[NFC_DATA_MAX];  // apdu / sign: the chip's answer; reselect / select / list: Chip[]
};

struct __attribute__((packed)) Screen {
  Head h;
  uint32_t id;
  uint8_t len;
  char data[SCREEN_MAX];
};

struct __attribute__((packed)) StatsReq {
  Head h;
  uint32_t id;
};

enum StationTask : uint8_t { T_LOOP, T_NFC, T_OLED, T_PRESS, T_COUNT };

struct __attribute__((packed)) StatsRes {
  Head h;
  uint32_t id;
  uint32_t upMs;
  uint32_t dropped;
  uint32_t sendFails;
  uint16_t stack[T_COUNT];  // each task's lowest free stack, bytes
};

// ---- building and reading ----

// The size of the header part of a packet with a trailing variable array.
constexpr size_t NFC_REQ_HEAD = offsetof(NfcReq, data);
constexpr size_t NFC_RES_HEAD = offsetof(NfcRes, data);
constexpr size_t SCREEN_HEAD = offsetof(Screen, data);

inline size_t sizeOf(const NfcReq &p) { return NFC_REQ_HEAD + p.len; }
inline size_t sizeOf(const NfcRes &p) { return NFC_RES_HEAD + p.len; }
inline size_t sizeOf(const Screen &p) { return SCREEN_HEAD + p.len; }
template <class T> size_t sizeOf(const T &) { return sizeof(T); }

template <class T> void head(T &p, Kind kind, uint8_t flags) {
  memset(&p, 0, sizeof p);
  p.h.magic = MAGIC;
  p.h.kind = kind;
  p.h.flags = flags;
}

// The kind of a received packet, or 0 if it isn't one of ours.
inline uint8_t kindOf(const uint8_t *d, size_t len) {
  if (len < sizeof(Head) || d[0] != MAGIC || d[1] == 0 || d[1] >= K_COUNT) return 0;
  return d[1];
}

// A received packet copied out of the radio's buffer (packed, so no alignment needed): true when it is a whole `T`.
// Fixed-size kinds must match exactly; the variable ones must match their own length field.
template <class T> bool read(T &out, const uint8_t *d, size_t len) {
  if (len != sizeof(T)) return false;
  memcpy(&out, d, len);
  return true;
}
template <class T> bool readVar(T &out, const uint8_t *d, size_t len, size_t headLen, size_t lenAt, size_t lenSize,
                                size_t max) {
  if (len < headLen || len > sizeof(T)) return false;
  size_t n = d[lenAt] | (lenSize == 2 ? d[lenAt + 1] << 8 : 0);
  if (n > max || headLen + n != len) return false;
  memset(&out, 0, sizeof out);
  memcpy(&out, d, len);
  return true;
}
template <> inline bool read(NfcReq &out, const uint8_t *d, size_t len) {
  return readVar(out, d, len, NFC_REQ_HEAD, offsetof(NfcReq, len), 2, APDU_MAX);
}
template <> inline bool read(NfcRes &out, const uint8_t *d, size_t len) {
  return readVar(out, d, len, NFC_RES_HEAD, offsetof(NfcRes, len), 2, NFC_DATA_MAX);
}
template <> inline bool read(Screen &out, const uint8_t *d, size_t len) {
  return readVar(out, d, len, SCREEN_HEAD, offsetof(Screen, len), 1, SCREEN_MAX);
}

// The largest packet: what a buffer for any packet must hold.
constexpr size_t PACKET_MAX = sizeof(NfcRes);

}  // namespace egb
