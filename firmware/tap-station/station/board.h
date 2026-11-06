// The station board (01Space ESP32-S3 0.42" OLED) and what its tasks share.
#pragma once

#include <stdint.h>

#include "feedback.h"

namespace st {

constexpr uint8_t PIN_OLED_SDA = 41;
constexpr uint8_t PIN_OLED_SCL = 40;
constexpr uint8_t PIN_NFC_SDA = 35;  // the PN532 on the S3's second I2C controller (Wire1)
constexpr uint8_t PIN_NFC_SCL = 36;
constexpr int8_t PIN_NFC_IRQ = 37;   // optional: the driver finds out whether it's wired
constexpr uint8_t PIN_MOTOR = 16;
constexpr uint8_t PIN_BUTTON = 0;    // BOOT; free to read once the board has booted
constexpr uint8_t PIN_RGB = 39;      // WS2812; the red LED beside it is the power light

// Where the chip on the reader is in the Pi's session: the NFC task writes it, the LED and the OLED read it.
extern Shared feedback;

}  // namespace st
