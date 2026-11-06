// The one resend scheme for everything that must arrive: a packet is kept in a slot and sent again on a clock until
// the far side acks it (Got, an NFC reply, a stats reply) or the slot gives up. Plain C++ with the clock passed in, so
// the host tests run it on a fake clock. One task owns a pool: it starts, polls and acks its slots.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "config.h"
#include "wire.h"

namespace egb {

struct Policy {
  uint16_t everyMs;     // between sends
  uint8_t maxSends;     // 0: no cap, only the deadline
  uint16_t deadlineMs;  // 0: no deadline, only the cap
};

constexpr Policy POLICY_PACKET = {PACKET_EVERY_MS, PACKET_TRIES, 0};
constexpr Policy POLICY_NFC = {NFC_EVERY_MS, 0, NFC_DEADLINE_MS};
constexpr Policy POLICY_SCREEN = {SCREEN_EVERY_MS, 0, SCREEN_DEADLINE_MS};

struct Slot {
  enum Due : uint8_t { IDLE, WAIT, SEND, EXPIRED };

  uint8_t buf[PACKET_MAX];
  uint16_t len;
  uint8_t to[6];
  uint8_t kind;    // what the far side's ack names...
  uint32_t id;     // ...with this id
  uint8_t station; // the owner's bookkeeping: which station (receiver) ...
  uint32_t ref;    // ...and the caller's id for it
  Policy policy;
  uint32_t startMs, startUs, nextMs;
  uint8_t sends;
  bool used;

  // Takes a packet whose first copy goes out now (the caller sends it); its `tries` byte counts the sends.
  void start(const void *packet, size_t n, const uint8_t dest[6], Policy p, uint32_t nowMs, uint32_t nowUs) {
    memcpy(buf, packet, n);
    len = (uint16_t)n;
    memcpy(to, dest, 6);
    kind = buf[1];
    memcpy(&id, buf + sizeof(Head), 4);  // every acked kind has its id right after the head
    policy = p;
    startMs = nowMs;
    startUs = nowUs;
    nextMs = nowMs + p.everyMs;
    sends = 1;
    buf[3] = 1;
    used = true;
  }

  // What to do now: SEND (buf is ready, its tries updated), EXPIRED (the slot is free again), or nothing.
  Due poll(uint32_t nowMs) {
    if (!used) return IDLE;
    if (policy.deadlineMs && sinceMs(nowMs, startMs) >= (int32_t)policy.deadlineMs) {
      used = false;
      return EXPIRED;
    }
    if (sinceMs(nowMs, nextMs) < 0) return WAIT;
    if (policy.maxSends && sends >= policy.maxSends) {
      used = false;
      return EXPIRED;
    }
    sends++;
    buf[3] = sends;
    nextMs = nowMs + policy.everyMs;
    return SEND;
  }

  // Milliseconds until poll() has something to do (0: now), or -1 when the slot is free.
  int32_t dueInMs(uint32_t nowMs) const {
    if (!used) return -1;
    int32_t due = sinceMs(nextMs, nowMs);
    if (policy.deadlineMs) {
      int32_t end = sinceMs(startMs + policy.deadlineMs, nowMs);
      if (end < due) due = end;
    }
    return due < 0 ? 0 : due;
  }
};

template <size_t N> struct Pool {
  Slot slots[N];

  Slot *free() {
    for (auto &s : slots)
      if (!s.used) return &s;
    return nullptr;
  }

  // The slot in use for this station and kind (one NFC request and one screen in flight per station).
  Slot *find(uint8_t station, uint8_t kind) {
    for (auto &s : slots)
      if (s.used && s.station == station && s.kind == kind) return &s;
    return nullptr;
  }

  // The slot an ack names, freed; nullptr when nothing was waiting for it (a late copy).
  Slot *take(uint8_t station, uint8_t kind, uint32_t id) {
    for (auto &s : slots) {
      if (s.used && s.station == station && s.kind == kind && s.id == id) {
        s.used = false;
        return &s;
      }
    }
    return nullptr;
  }

  // The soonest any slot needs polling, in ms (-1: none in use).
  int32_t dueInMs(uint32_t nowMs) const {
    int32_t due = -1;
    for (auto &s : slots) {
      int32_t d = s.dueInMs(nowMs);
      if (d >= 0 && (due < 0 || d < due)) due = d;
    }
    return due;
  }
};

}  // namespace egb
