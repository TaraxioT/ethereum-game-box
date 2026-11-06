// What the person holding the chip sees: the LED and OLED table, as one pure function of where the chip is in the
// Pi's session. The NFC task writes the chip's state, the OLED task when the Pi's screen last changed (one writer per
// field, every field atomic); the LED and the OLED task read it. Plain C++, tested on the host.
//
//   LED                  OLED                                 when
//   blue, blinking       inverted, slow sweep: HOLD / reading  a chip landed, or the app is reading it (until
//                                                             DONE_IDLE_MS after its last request)
//   blue, fast blink     inverted, fast sweep: HOLD STILL      a sign request runs (and while the Pi retries a fail)
//   green                check mark: DONE                     the read ended well (DONE_IDLE_MS after its last good
//                                                             request, or at the lift), or the signature is back
//   red for a second     cross: AGAIN / tap again             the sign failed and the Pi didn't retry within 0.6 s
//   red for a second     cross: TOO SOON / tap again          the chip left mid-sign
//   white or off         the Pi's screen (big/small, or TAP)  anything else, a chip resting on the reader included
// A result (DONE, AGAIN, TOO SOON) shows for RESULT_HOLD_MS, or until the Pi sends a different screen, whichever is
// first; then the Pi's screen is back even while the chip stays on the reader (players leave badges on a table). A
// reader in trouble wins over everything: NO READER, or REPLUG.
#pragma once

#include <stdint.h>

#include <atomic>

#include "egb/config.h"

namespace st {

constexpr uint32_t BLINK_MS = 200;
constexpr uint32_t SIGN_BLINK_MS = 80;
constexpr uint32_t DONE_IDLE_MS = 500;      // no request this long after a good one: the app has what it needed
constexpr uint32_t RESULT_HOLD_MS = 1500;   // a result shows this long, then the Pi's screen
constexpr uint32_t RED_MS = 1000;
constexpr uint32_t FAIL_SHOW_MS = 600;      // a failed sign stays HOLD STILL this long: the Pi retries at once
constexpr uint32_t SWEEP_MS = 125;          // the sweep's step while the chip is held: 8 frames a second

constexpr uint32_t WHITE = 90 * 0x010101;  // the receiver's toggle
constexpr uint32_t BLUE = 90;
constexpr uint32_t GREEN = 80 << 8;
constexpr uint32_t RED = 90 << 16;

enum Phase : uint8_t { PH_DETECTED, PH_READING, PH_SIGNING, PH_SIGNED, PH_FAILED };

enum Look : uint8_t {
  LOOK_IDLE,   // the Pi's text, or TAP
  LOOK_HOLD,   // inverted, slow sweep
  LOOK_SIGN,   // inverted, fast sweep
  LOOK_DONE,   // check mark
  LOOK_FAIL,   // cross
  LOOK_FAULT,  // the reader's trouble, plain
};

// The station's own feedback texts, each of which the Pi may reword.
enum Feedback : uint8_t { FB_HOLD, FB_SIGN, FB_DONE, FB_FAIL, FB_COUNT, FB_NONE = FB_COUNT };

// A copy of the shared state, taken at one moment.
struct Snapshot {
  bool nfcOk, sclStuck, chipOn, tooSoon;
  uint8_t phase;
  uint32_t detectedMs, liftedMs, failedMs, signedMs, taps;
  uint32_t activeMs;  // the chip's last request, start or end (or its detection)
  uint32_t goodMs;    // the end of its last good request (0: the last one failed, or none yet)
  bool screenSet;     // the Pi has sent a screen ...
  uint32_t screenMs;  // ... which last changed then
};

// The shared state: written by the NFC task, apart from the screen's two fields (the OLED task).
struct Shared {
  std::atomic<bool> nfcOk{false}, sclStuck{false}, chipOn{false}, tooSoon{false}, screenSet{false};
  std::atomic<uint8_t> phase{PH_DETECTED};
  std::atomic<uint32_t> detectedMs{0}, liftedMs{0}, failedMs{0}, signedMs{0}, taps{0}, activeMs{0}, goodMs{0},
      screenMs{0};

  Snapshot snap() const {
    return {nfcOk, sclStuck, chipOn, tooSoon, phase, detectedMs, liftedMs, failedMs, signedMs, taps,
            activeMs, goodMs, screenSet, screenMs};
  }
};

struct Shown {
  uint32_t led;     // 0xRRGGBB
  Look look;
  uint8_t fb;       // which feedback text (FB_NONE: idle or fault)
  bool soon;        // FB_FAIL because the chip left mid-sign: TOO SOON
  uint32_t sweep;   // the sweep's step (HOLD / SIGN), counted from the tap
};

inline bool failShown(const Snapshot &s, uint32_t now) {
  return s.phase == PH_FAILED && egb::sinceMs(now, s.failedMs) >= (int32_t)FAIL_SHOW_MS;
}

// The result the chip's session came to, if any: its look and when it began (it shows from then).
struct Result {
  Look look;  // LOOK_DONE or LOOK_FAIL; LOOK_IDLE: none
  bool soon;
  uint32_t startMs;
};

inline Result result(const Snapshot &s, uint32_t now) {
  if (!s.taps) return {LOOK_IDLE, false, 0};
  if (!s.chipOn && s.tooSoon) return {LOOK_FAIL, true, s.liftedMs};
  if (s.phase == PH_SIGNED) return {LOOK_DONE, false, s.signedMs};
  if (failShown(s, now)) return {LOOK_FAIL, false, s.failedMs + FAIL_SHOW_MS};
  if (s.phase == PH_READING && s.goodMs) {
    uint32_t start = s.goodMs + DONE_IDLE_MS;  // nothing more from the app: it has what it needed
    // Lifted sooner: done then.
    if (!s.chipOn && egb::sinceMs(s.liftedMs, s.goodMs) >= 0 && egb::sinceMs(s.liftedMs, start) < 0) start = s.liftedMs;
    return {LOOK_DONE, false, start};
  }
  return {LOOK_IDLE, false, 0};
}

// Whether that result is showing now: begun, not past RESULT_HOLD_MS, and no different screen from the Pi since.
inline bool resultOn(const Snapshot &s, const Result &r, uint32_t now) {
  int32_t age = egb::sinceMs(now, r.startMs);
  bool newerScreen = s.screenSet && egb::sinceMs(s.screenMs, r.startMs) > 0;
  return r.look != LOOK_IDLE && age >= 0 && age < (int32_t)RESULT_HOLD_MS && !newerScreen;
}

inline Shown shown(const Snapshot &s, uint32_t now, bool myLed) {
  Shown v = {myLed ? WHITE : 0, LOOK_IDLE, FB_NONE, false, 0};
  Result r = result(s, now);
  bool busy = s.chipOn && egb::sinceMs(now, s.activeMs) < (int32_t)DONE_IDLE_MS;  // the app is at the chip
  bool retrying = s.chipOn && s.phase == PH_FAILED && !failShown(s, now);
  if (!s.nfcOk) {
    v.look = LOOK_FAULT;
  } else if (s.chipOn && (s.phase == PH_SIGNING || retrying)) {
    v.look = LOOK_SIGN;
    v.fb = FB_SIGN;
  } else if (busy && (s.phase == PH_DETECTED || s.phase == PH_READING)) {
    v.look = LOOK_HOLD;
    v.fb = FB_HOLD;
  } else if (resultOn(s, r, now)) {
    v.look = r.look;
    v.fb = r.look == LOOK_DONE ? FB_DONE : FB_FAIL;
    v.soon = r.soon;
    if (r.look == LOOK_DONE) v.led = GREEN;
    else if (egb::sinceMs(now, r.startMs) < (int32_t)RED_MS) v.led = RED;
  }
  if (v.look == LOOK_HOLD || v.look == LOOK_SIGN) {
    int32_t held = egb::sinceMs(now, s.detectedMs);
    uint32_t period = v.look == LOOK_SIGN ? SIGN_BLINK_MS : BLINK_MS;
    v.led = held < 0 || ((uint32_t)held / period) % 2 == 0 ? BLUE : 0;
    v.sweep = held > 0 ? (uint32_t)held / SWEEP_MS : 0;  // from the left edge on every tap
  }
  return v;
}

inline uint32_t ledColour(const Snapshot &s, uint32_t now, bool myLed) { return shown(s, now, myLed).led; }

// Milliseconds until shown() can change with no new event (a blink, a sweep step, a result beginning or running
// out), or -1.
inline int32_t nextChangeMs(const Snapshot &s, uint32_t now) {
  int32_t best = -1;
  auto at = [&](uint32_t whenMs) {
    int32_t d = egb::sinceMs(whenMs, now);
    if (d > 0 && (best < 0 || d < best)) best = d;
  };
  auto every = [&](uint32_t fromMs, uint32_t period) {
    int32_t on = egb::sinceMs(now, fromMs);
    if (on >= 0) at(now + period - (uint32_t)on % period);
  };
  Shown v = shown(s, now, false);
  if (v.look == LOOK_HOLD || v.look == LOOK_SIGN) {
    every(s.detectedMs, SIGN_BLINK_MS);  // the fast blink, the slow one and the sweep, all counted from the tap
    every(s.detectedMs, BLINK_MS);
    every(s.detectedMs, SWEEP_MS);
  }
  if (s.chipOn) at(s.activeMs + DONE_IDLE_MS);
  if (s.phase == PH_FAILED) at(s.failedMs + FAIL_SHOW_MS);
  Result r = result(s, now);
  if (r.look != LOOK_IDLE) {
    at(r.startMs);
    at(r.startMs + RED_MS);
    at(r.startMs + RESULT_HOLD_MS);
  }
  return best;
}

}  // namespace st
