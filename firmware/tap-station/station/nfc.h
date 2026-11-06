// The NFC task's own state and helpers, shared by its files (reader.cpp: finding and watching chips; serve.cpp: the
// Pi's requests; applet.cpp: the HaLo applet select). Only the NFC task touches any of it.
#pragma once

#include <EgbLink.h>

#include <atomic>

#include "pn532.h"

namespace st {
namespace nfc {

extern Pn532 pn532;

// The chip on the reader (or the last one).
struct Held {
  egb::Chip chip;
  uint32_t tapId;
  uint32_t boot;        // this boot's number, in every tap and gone
  uint32_t detectedUs;  // when the detection that found it started
  uint32_t servedMs;    // the last request the chip answered
  uint8_t misses;       // presence checks in a row without it
  bool talked;          // a block was exchanged since it was activated: it answers the R(NAK) presence check now
  bool pristine;        // nothing but the station's own applet select since it was activated
  bool deaf;            // it failed the presence check before anything talked to it: re-read it instead
};
extern Held held;

// A chip answered (a read, or a request that cycled the field): a new one is a tap, and the old one, if any, gone.
// `startUs` is when the detection that found it started; `poll`: found by the task's own read, not a request. True
// for a new chip.
bool found(const egb::Chip &c, uint32_t startUs, uint32_t gapUs, bool poll);
void lost();

// The HaLo applet (applet.cpp). select() sends the SELECT the chip answered last first, and keeps its answer: a Pi
// SELECT with the same bytes, with nothing exchanged since, is answered from it. Returns the status word (0: none).
// found() runs it right after a new ISO-DEP chip's tap has gone out.
uint16_t select(uint32_t &us, uint32_t &waitUs);
bool fromCache(const uint8_t *apdu, size_t len, egb::NfcRes &r);
void forgetSelect();  // anything else was exchanged, or the field went off
uint16_t cachedSw();  // the kept select's status word, 0 when none

void serve(const egb::NfcReq &q, const uint8_t from[6]);  // serve.cpp
extern std::atomic<uint32_t> busyId;  // the request being run: the radio callback drops its resends

void runBench(const char *what, uint16_t n);  // bench.cpp

// A line on the station's own serial (dropped if there's no room).
void say(const char *line);

}  // namespace nfc
}  // namespace st
