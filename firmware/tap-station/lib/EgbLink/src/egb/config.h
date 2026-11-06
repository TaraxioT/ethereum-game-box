// The link's constants, shared by the stations and the receiver. Plain C++: the host tests include it too.
#pragma once

#include <stdint.h>

namespace egb {

constexpr const char *FW_VERSION = "1.0.0";

// ---- radio ----
constexpr uint8_t CHANNEL = 1;  // both ends sit on this Wi-Fi channel; nothing joins a network
constexpr uint32_t PING_MS = 250;
// Silence (no packet of any kind) before a link counts as down: ten pings, so a lossy link (a station behind a
// laptop's metal lid lost 60 % of them) never reads as a dead one. Compared signed (see sinceMs).
constexpr uint32_t LINK_TIMEOUT_MS = 2500;

// ---- resends ----
// Presses and buzzes go again every PACKET_EVERY_MS until acked,
// PACKET_TRIES sends at most; each id counts once on the far side.
constexpr uint16_t PACKET_EVERY_MS = 20;
constexpr uint8_t PACKET_TRIES = 25;
// Taps, gones and signatures go again every 20 ms for as long as the Pi may still wait for them: a link counts as down
// only after LINK_TIMEOUT_MS of silence, and the Pi gives a dropped link PI_GRACE_MS more before it gives up on a tap.
constexpr uint16_t PI_GRACE_MS = 2000;
constexpr uint16_t CHIP_EVENT_DEADLINE_MS = LINK_TIMEOUT_MS + PI_GRACE_MS;
// NFC requests: again every 40 ms until the station's reply, 3 s at most (a signature takes up to ~1.5 s).
constexpr uint16_t NFC_EVERY_MS = 40;
constexpr uint16_t NFC_DEADLINE_MS = 3000;
// Screens and stats requests: again every 40 ms until acked, 1 s at most.
constexpr uint16_t SCREEN_EVERY_MS = 40;
constexpr uint16_t SCREEN_DEADLINE_MS = 1000;

// ---- the press button ----
constexpr uint32_t DEBOUNCE_US = 30000;  // the button must have been up this long before a fall counts as a press
constexpr uint32_t RELEASE_US = 15000;   // ...and up this long after one before it counts as released

// ---- payload limits ----
constexpr uint16_t APDU_MAX = 255;      // the longest APDU the Pi may send
constexpr uint16_t NFC_DATA_MAX = 264;  // a chip's longest answer through the PN532, or six chips (list)
constexpr uint8_t SCREEN_MAX = 200;     // a screen payload's bytes
constexpr uint8_t CHIP_UID_MAX = 10;
constexpr uint8_t CHIP_ATS_MAX = 24;
constexpr uint8_t MAX_STATIONS = 4;

// ---- buzz ----
constexpr uint16_t BUZZ_MS_DEFAULT = 80;
constexpr uint16_t BUZZ_MS_MAX = 2000;
constexpr uint8_t BUZZ_PULSES_MAX = 3;
constexpr uint16_t BUZZ_GAP_MS = 60;

// Milliseconds from `then` to `now`, negative when `then` is later: a time another task stamped after the caller
// read the clock must not read as ~49 days ago (that once showed a live link as dead for one pass).
inline int32_t sinceMs(uint32_t now, uint32_t then) { return (int32_t)(now - then); }

}  // namespace egb
