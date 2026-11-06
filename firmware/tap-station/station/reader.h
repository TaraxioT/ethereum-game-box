// The reader: the NFC task finds the PN532 (and finds it again if it stops answering), reads chips as fast as it
// answers, sends a tap the moment one lands (the motor already running), checks a resting chip is still there, and
// runs the Pi's requests between those checks.
#pragma once

#include <EgbLink.h>

namespace st {
namespace reader {

void begin();

// From the radio callback: the Pi's request. Each id runs once; a resend while it runs is dropped, and a resend of the
// one just finished gets the same reply again.
void request(const egb::NfcReq &q, const uint8_t from[6]);

// From the CLI: timing runs on the chip resting on the reader, printed on the station's serial.
void bench(const char *what, uint16_t n);

uint32_t stackLeft();

}  // namespace reader
}  // namespace st
