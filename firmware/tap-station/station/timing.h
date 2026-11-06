// The reader's clock: how long a read may take, how often a resting chip is checked, and the detection window a new
// tap reports (`gap_us`). Plain C++, tested on the host.
#pragma once

#include <stdint.h>

namespace st {

constexpr uint32_t READ_TIMEOUT_MS = 60;  // one look for a chip
constexpr uint32_t PRESENCE_MS = 20;      // between checks of a resting chip
// The chip landed during the detection before the one that found it, which never spans more than a read and the
// wait before it. Anything longer (the first read after boot, or after the reader was missing or busy with the Pi)
// says nothing about when it landed, so it is cut to this.
constexpr uint32_t GAP_MAX_US = (READ_TIMEOUT_MS + PRESENCE_MS) * 1000;

inline uint32_t gapUs(uint32_t startUs, uint32_t lastStartUs) {
  uint32_t gap = startUs - lastStartUs;
  return gap < GAP_MAX_US ? gap : GAP_MAX_US;
}

}  // namespace st
