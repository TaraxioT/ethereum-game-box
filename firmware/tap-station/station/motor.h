// The vibration motor (GPIO16): switched on at once by whoever asks (the radio callback for the Pi's buzz, the NFC
// task for a tap) and off by a timer, so nothing waits for a buzz to end.
#pragma once

#include <stdint.h>

namespace st {
namespace motor {

void begin();
void buzz(uint16_t ms, uint8_t pulses = 1);  // pulses come egb::BUZZ_GAP_MS apart

}  // namespace motor
}  // namespace st
