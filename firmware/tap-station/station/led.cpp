#include "led.h"

#include <Arduino.h>
#include <EgbLink.h>

#include <atomic>

#include "board.h"

namespace st {
namespace led {

static SemaphoreHandle_t lock;
static std::atomic<bool> white{false};

void begin() {
  lock = xSemaphoreCreateMutex();
  show();
}

void show() {
  static uint32_t written = 0xFFFFFFFF;
  xSemaphoreTake(lock, portMAX_DELAY);
  uint32_t c = ledColour(feedback.snap(), millis(), white);
  if (c != written) {
    written = c;
    rgbLedWrite(PIN_RGB, c >> 16, (c >> 8) & 0xff, c & 0xff);
  }
  xSemaphoreGive(lock);
}

void toggleMine() {
  white = !white;
  egb::radio::setFlag(egb::F_LED, white);
  show();
}

bool mine() { return white; }

}  // namespace led
}  // namespace st
