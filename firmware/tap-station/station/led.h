// The RGB LED: the colour feedback.h gives for the moment, written only when it changes. Set from the radio callback
// (the receiver's press switches the white before the ack), the NFC task (a tap turns it blue at once) and the OLED
// task (the blink), so each write is under a lock.
#pragma once

namespace st {
namespace led {

void begin();
void show();        // the colour for now
void toggleMine();  // the receiver's press: the white on or off
bool mine();

}  // namespace led
}  // namespace st
