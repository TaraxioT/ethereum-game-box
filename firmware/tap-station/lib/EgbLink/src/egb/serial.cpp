#include "serial.h"

#include <atomic>

namespace egb {
namespace serial {

static std::atomic<uint32_t> droppedLines{0};
static void (*inputHook)() = nullptr;

static void onRx(void *, esp_event_base_t, int32_t, void *) {
  if (inputHook) inputHook();
}

void begin(size_t rxBuffer, size_t txBuffer, void (*onInput)()) {
  Serial.setRxBufferSize(rxBuffer);  // before begin: the longest command is longer than the default 256 bytes
  Serial.setTxBufferSize(txBuffer);  // ...and so is the longest reply
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);
  inputHook = onInput;
  Serial.onEvent(ARDUINO_HW_CDC_RX_EVENT, onRx);
}

bool line(const char *text, size_t len) {
  // With no TX timeout a partial write would cut the line short, so check for room first. Another task holding the
  // port's lock reads as no room: the line is dropped rather than waited for.
  if ((size_t)Serial.availableForWrite() < len || Serial.write((const uint8_t *)text, len) != len) {
    droppedLines++;
    return false;
  }
  return true;
}

bool lineWaiting(const char *text, size_t len, uint32_t maxWaitMs) {
  uint32_t t0 = millis();
  for (size_t k = 0; k < len;) {
    size_t room = Serial.availableForWrite();
    size_t sent = room ? Serial.write((const uint8_t *)text + k, room < len - k ? room : len - k) : 0;
    k += sent;
    if (!sent) {
      if (millis() - t0 >= maxWaitMs) {
        droppedLines++;
        return false;
      }
      delay(1);
    }
  }
  return true;
}

uint32_t dropped() { return droppedLines.load(); }

}  // namespace serial
}  // namespace egb
