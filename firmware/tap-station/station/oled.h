// The OLED (SSD1306 72x40 on its own bus, SDA 41 / SCL 40): drawn by a low-priority task of its own, so a redraw
// (~9 ms of I2C for a whole frame) never holds up a read or the radio. It wakes when something changes (poke, a
// screen from the Pi) or when feedback.h says the picture moves on its own (a blink, a sweep step, a result running
// out), and sends only the 8-pixel rows that changed. It also drives the LED's blink.
#pragma once

#include <EgbLink.h>

namespace st {
namespace oled {

void begin(bool radioOk);  // a failed ESP-NOW start shows on the screen
void poke();               // the state changed: draw now
void screenIn(const egb::Screen &s);  // from the radio callback: the newest wins
void frame();              // print the screen on the station's serial (`frame 72 40 <hex>`, for tools/frame.py)
uint32_t stackLeft();

}  // namespace oled
}  // namespace st
