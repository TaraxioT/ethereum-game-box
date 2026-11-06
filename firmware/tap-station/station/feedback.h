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
//   red/amber flicker    cross: NOT NOW / not your turn       a chip landed while the Pi's screen says taps aren't
//                                                             welcome (mode=shut): decided here, no round trip
//   the mode's colour    the Pi's screen (big/small, or TAP)  anything else, a chip resting on the reader included:
//                                                             cyan breathing (mode=open), green breathing (play),
//                                                             dim amber (shut), off (no mode); the receiver's white
//                                                             wins over all three
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
constexpr uint32_t NOPE_MS = 1200;          // NOT NOW shows this long after an unwelcome tap
constexpr uint32_t NOPE_FLICKER_MS = 100;   // its LED: red and amber, swapped this often ...
constexpr uint32_t NOPE_RED_MS = 600;       // ... for this long, then amber
constexpr uint32_t BREATH_STEP_MS = 40;     // the idle LED's breathing: 25 steps a second
constexpr uint32_t OPEN_BREATH_MS = 2400;   // one breath, waiting for a tap outside a game
constexpr uint32_t PLAY_BREATH_MS = 1200;   // one breath, a game waiting for this station's tap

constexpr uint32_t WHITE = 90 * 0x010101;  // the receiver's toggle
constexpr uint32_t BLUE = 90;
constexpr uint32_t GREEN = 80 << 8;
constexpr uint32_t RED = 90 << 16;
constexpr uint32_t AMBER = 70 << 16 | 22 << 8;
constexpr uint32_t SHUT_AMBER = 14 << 16 | 4 << 8;  // dim: the station is resting
constexpr uint32_t CYAN = 50 << 8 | 90;
constexpr uint32_t PLAY_GREEN = 90 << 8 | 18;

// What the Pi's screen says a tap means now (the `mode` key; protocol.md, Screens).
enum Mode : uint8_t {
  MODE_NONE,  // not sent: the LED stays off between taps, as before modes
  MODE_OPEN,  // taps welcome, no game running (join, lobby, home)
  MODE_PLAY,  // a game waits for this station's tap
  MODE_SHUT,  // taps not welcome: a chip gets NOT NOW at once, from the station itself
};

enum Phase : uint8_t { PH_DETECTED, PH_READING, PH_SIGNING, PH_SIGNED, PH_FAILED };

enum Look : uint8_t {
  LOOK_IDLE,   // the Pi's text, or TAP
  LOOK_HOLD,   // inverted, slow sweep
  LOOK_SIGN,   // inverted, fast sweep
  LOOK_DONE,   // check mark
  LOOK_FAIL,   // cross
  LOOK_FAULT,  // the reader's trouble, plain
  LOOK_NOPE,   // cross: an unwelcome tap
};

// The station's own feedback texts, each of which the Pi may reword.
enum Feedback : uint8_t { FB_HOLD, FB_SIGN, FB_DONE, FB_FAIL, FB_NOPE, FB_COUNT, FB_NONE = FB_COUNT };

// A copy of the shared state, taken at one moment.
struct Snapshot {
  bool nfcOk, sclStuck, chipOn, tooSoon;
  bool nope;     // the last chip landed while taps weren't welcome
  uint8_t phase;
  uint8_t mode;  // the Pi's screen's Mode
  uint32_t detectedMs, liftedMs, failedMs, signedMs, taps;
  uint32_t activeMs;  // the chip's last request, start or end (or its detection)
  uint32_t goodMs;    // the end of its last good request (0: the last one failed, or none yet)
  bool screenSet;     // the Pi has sent a screen ...
  uint32_t screenMs;  // ... which last changed then
};

// The shared state: written by the NFC task, apart from the screen's three fields (the OLED task).
struct Shared {
  std::atomic<bool> nfcOk{false}, sclStuck{false}, chipOn{false}, tooSoon{false}, nope{false}, screenSet{false};
  std::atomic<uint8_t> phase{PH_DETECTED}, mode{MODE_NONE};
  std::atomic<uint32_t> detectedMs{0}, liftedMs{0}, failedMs{0}, signedMs{0}, taps{0}, activeMs{0}, goodMs{0},
      screenMs{0};

  Snapshot snap() const {
    return {nfcOk, sclStuck, chipOn, tooSoon, nope, phase, mode, detectedMs, liftedMs, failedMs, signedMs, taps,
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

// `c` at `level` of 255, each channel.
inline uint32_t dim(uint32_t c, uint32_t level) {
  return ((c >> 16 & 0xff) * level / 255) << 16 | ((c >> 8 & 0xff) * level / 255) << 8 | (c & 0xff) * level / 255;
}

// The breath's level at `now`: a triangle from a glow to full and back, in BREATH_STEP_MS steps.
inline uint32_t breath(uint32_t now, uint32_t period) {
  uint32_t t = (now / BREATH_STEP_MS * BREATH_STEP_MS) % period, half = period / 2;
  uint32_t up = t < half ? t : period - t;  // 0 .. half
  return 24 + up * (255 - 24) / half;
}

// The LED between taps: the mode's colour.
inline uint32_t modeLed(uint8_t mode, uint32_t now) {
  switch (mode) {
    case MODE_OPEN: return dim(CYAN, breath(now, OPEN_BREATH_MS));
    case MODE_PLAY: return dim(PLAY_GREEN, breath(now, PLAY_BREATH_MS));
    case MODE_SHUT: return SHUT_AMBER;
    default: return 0;
  }
}

// An unwelcome tap's NOT NOW is showing.
inline bool nopeOn(const Snapshot &s, uint32_t now) {
  int32_t age = egb::sinceMs(now, s.detectedMs);
  return s.nope && s.taps && age >= 0 && age < (int32_t)NOPE_MS;
}

inline Shown shown(const Snapshot &s, uint32_t now, bool myLed) {
  Shown v = {myLed ? WHITE : modeLed(s.mode, now), LOOK_IDLE, FB_NONE, false, 0};
  Result r = result(s, now);
  bool busy = s.chipOn && egb::sinceMs(now, s.activeMs) < (int32_t)DONE_IDLE_MS;  // the app is at the chip
  bool retrying = s.chipOn && s.phase == PH_FAILED && !failShown(s, now);
  if (!s.nfcOk) {
    v.look = LOOK_FAULT;
  } else if (s.chipOn && (s.phase == PH_SIGNING || retrying)) {
    v.look = LOOK_SIGN;
    v.fb = FB_SIGN;
  } else if (nopeOn(s, now)) {
    int32_t age = egb::sinceMs(now, s.detectedMs);
    v.look = LOOK_NOPE;
    v.fb = FB_NOPE;
    bool flicker = age < (int32_t)NOPE_RED_MS;
    v.led = flicker && ((uint32_t)age / NOPE_FLICKER_MS) % 2 == 0 ? RED : AMBER;
  } else if (s.nope) {
    // An unwelcome tap's chip: whatever the Pi still reads off it shows nothing (it's not a turn).
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
  if (v.look == LOOK_IDLE && (s.mode == MODE_OPEN || s.mode == MODE_PLAY)) at(now + BREATH_STEP_MS - now % BREATH_STEP_MS);
  if (v.look == LOOK_NOPE) {
    every(s.detectedMs, NOPE_FLICKER_MS);
    at(s.detectedMs + NOPE_MS);
  }
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
