// The board's USB serial, which never waits: with nothing reading the port, the ESP32's USB serial otherwise stalls a
// write for up to 100 ms (an unread port once froze a whole loop for seconds). Each line goes out whole or not at
// all, and a line with no room is dropped and counted.
#pragma once

#include <Arduino.h>

namespace egb {
namespace serial {

// Opens Serial with these buffer sizes and no TX timeout; `onInput` runs (in the USB event task) when bytes arrive.
void begin(size_t rxBuffer, size_t txBuffer, void (*onInput)());

// One whole line (its text ends in '\n'), or nothing. Safe from any task.
bool line(const char *text, size_t len);

// A long line for a host that asked for it (the station's `frame`): waits for room, `maxWaitMs` at most.
bool lineWaiting(const char *text, size_t len, uint32_t maxWaitMs);

uint32_t dropped();

}  // namespace serial
}  // namespace egb
