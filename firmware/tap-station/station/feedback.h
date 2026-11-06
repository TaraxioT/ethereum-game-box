// What the person holding the chip sees: the LED and OLED table, as one pure function of where the chip is in the
// Pi's session. The NFC task writes the state (one writer, every field atomic); the LED and the OLED task read it.
// Plain C++, tested on the host.
//
//   LED                  OLED                                 when
//   blue, blinking       inverted, slow sweep: HOLD / reading  a chip landed, or the app is reading it
//   blue, fast blink     inverted, fast sweep: HOLD STILL      a sign request runs (and while the Pi retries a fail)
//   green                check mark: DONE                     no request for DONE_IDLE_MS after a good one, or signed
//   red for a second     cross: AGAIN / tap again             the sign failed and the Pi didn't retry within 0.6 s
//   red for a second     cross: TOO SOON / tap again          the chip left mid-sign
//   white or off         the Pi's idle text (or TAP)          no chip; the receiver's BOOT toggles the white
// The result stays RESULT_HOLD_MS after the lift. A reader in trouble wins over everything: NO READER, or REPLUG.
#pragma once

#include <stdint.h>

#include <atomic>

#include "egb/config.h"

namespace st {

constexpr uint32_t BLINK_MS = 200;
constexpr uint32_t SIGN_BLINK_MS = 80;
constexpr uint32_t DONE_IDLE_MS = 500;      // no request this long after a good one: the app has what it needed
constexpr uint32_t RESULT_HOLD_MS = 1500;   // the result stays this long after the lift
constexpr uint32_t RED_MS = 1000;
constexpr uint32_t FAIL_SHOW_MS = 600;      // a failed sign stays HOLD STILL this long: the Pi retries at once
constexpr uint32_t SWEEP_MS = 125;          // the sweep's step while the chip is held: 8 frames a second

constexpr uint32_t WHITE = 90 * 0x010101;  // the receiver's toggle
constexpr uint32_t BLUE = 90;
constexpr uint32_t GREEN = 80 << 8;
constexpr uint32_t RED = 90 << 16;

enum Phase : uint8_t { PH_DETECTED, PH_READING, PH_SIGNING, PH_DONE, PH_SIGNED, PH_FAILED };

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
  uint32_t detectedMs, liftedMs, failedMs, taps;
};

// The shared state: written by the NFC task only.
struct Shared {
  std::atomic<bool> nfcOk{false}, sclStuck{false}, chipOn{false}, tooSoon{false};
  std::atomic<uint8_t> phase{PH_DETECTED};
  std::atomic<uint32_t> detectedMs{0}, liftedMs{0}, failedMs{0}, taps{0};

  Snapshot snap() const {
    return {nfcOk, sclStuck, chipOn, tooSoon, phase, detectedMs, liftedMs, failedMs, taps};
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

inline uint32_t ledColour(const Snapshot &s, uint32_t now, bool myLed) {
  bool good = s.phase == PH_DONE || s.phase == PH_SIGNED;
  if (s.chipOn) {
    if (good) return GREEN;
    if (failShown(s, now) && egb::sinceMs(now, s.failedMs) < (int32_t)(FAIL_SHOW_MS + RED_MS)) return RED;
    int32_t on = egb::sinceMs(now, s.detectedMs);
    bool fast = s.phase == PH_SIGNING || (s.phase == PH_FAILED && !failShown(s, now));
    uint32_t period = fast ? SIGN_BLINK_MS : BLINK_MS;
    return on < 0 || ((uint32_t)on / period) % 2 == 0 ? BLUE : 0;
  }
  int32_t off = egb::sinceMs(now, s.liftedMs);
  if (s.taps && good && off < (int32_t)RESULT_HOLD_MS) return GREEN;
  if (s.taps && s.tooSoon && off < (int32_t)RED_MS) return RED;
  return myLed ? WHITE : 0;
}

inline Shown shown(const Snapshot &s, uint32_t now, bool myLed) {
  Shown v = {ledColour(s, now, myLed), LOOK_IDLE, FB_NONE, false, 0};
  bool recent = !s.chipOn && egb::sinceMs(now, s.liftedMs) < (int32_t)RESULT_HOLD_MS;
  if (!s.nfcOk) {
    v.look = LOOK_FAULT;
  } else if (!s.taps || !(s.chipOn || recent)) {
    v.look = LOOK_IDLE;
  } else if (!s.chipOn && s.tooSoon) {
    v.look = LOOK_FAIL;
    v.fb = FB_FAIL;
    v.soon = true;
  } else if (s.phase == PH_SIGNED || s.phase == PH_DONE) {
    v.look = LOOK_DONE;
    v.fb = FB_DONE;
  } else if (s.phase == PH_FAILED && failShown(s, now)) {
    v.look = LOOK_FAIL;
    v.fb = FB_FAIL;
  } else if (s.phase == PH_SIGNING || s.phase == PH_FAILED) {
    v.look = LOOK_SIGN;
    v.fb = FB_SIGN;
  } else if (s.chipOn) {
    v.look = LOOK_HOLD;
    v.fb = FB_HOLD;
  }
  if ((v.look == LOOK_HOLD || v.look == LOOK_SIGN) && s.chipOn) {
    int32_t held = egb::sinceMs(now, s.detectedMs);
    v.sweep = held > 0 ? (uint32_t)held / SWEEP_MS : 0;  // from the left edge on every tap
  }
  return v;
}

// Milliseconds until shown() can change with no new event (a blink, a sweep step, a result running out), or -1.
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
  if (s.chipOn) {
    every(s.detectedMs, SIGN_BLINK_MS);  // the fast blink, the slow one and the sweep, all counted from the tap
    every(s.detectedMs, BLINK_MS);
    every(s.detectedMs, SWEEP_MS);
    if (s.phase == PH_FAILED) {
      at(s.failedMs + FAIL_SHOW_MS);
      at(s.failedMs + FAIL_SHOW_MS + RED_MS);
    }
  } else if (s.taps) {
    at(s.liftedMs + RED_MS);
    at(s.liftedMs + RESULT_HOLD_MS);
  }
  return best;
}

}  // namespace st
