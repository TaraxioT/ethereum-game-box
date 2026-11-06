// ESP-NOW for both boards, set up for latency: Wi-Fi channel 1 with no network to join, the radio never dozing, and
// unicast at 24 Mbps instead of ESP-NOW's 1 Mbps default (about ten times shorter on air; reliable at arm's length).
#pragma once

#include <Arduino.h>
#include <esp_now.h>

#include <atomic>

#include "wire.h"

namespace egb {
namespace radio {

extern const uint8_t BROADCAST[6];

// This board's state, carried in every packet it sends (F_LED, F_BTN, F_NFC).
extern std::atomic<uint8_t> myFlags;
inline void setFlag(uint8_t f, bool on) {
  if (on) myFlags.fetch_or(f);
  else myFlags.fetch_and((uint8_t)~f);
}
inline bool flag(uint8_t f) { return myFlags.load() & f; }

// Wi-Fi up and ESP-NOW started, with `onRecv` as the receive callback (it runs in the Wi-Fi task). False when ESP-NOW
// wouldn't start.
bool begin(esp_now_recv_cb_t onRecv);

// Adds a peer once (unicast peers at 24 Mbps). Safe from any task.
bool addPeer(const uint8_t mac[6]);

// Sends one packet with this board's flags in its head. A refusal (ESP-NOW's queue full, an unknown peer) is counted,
// not retried here: everything that must arrive sits in a resend slot.
bool send(const uint8_t to[6], void *packet, size_t len);

uint32_t sendFails();  // sends refused, or never acked by the peer's radio, since boot
uint32_t rateFails();  // peers left at 1 Mbps because the rate couldn't be set

// A MAC packed into 48 bits, so it can sit in one atomic.
inline uint64_t macBits(const uint8_t m[6]) {
  uint64_t v = 0;
  for (int i = 0; i < 6; i++) v = v << 8 | m[i];
  return v;
}
inline void macBytes(uint64_t v, uint8_t m[6]) {
  for (int i = 5; i >= 0; i--, v >>= 8) m[i] = (uint8_t)v;
}

}  // namespace radio
}  // namespace egb
