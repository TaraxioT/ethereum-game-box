#include "motor.h"

#include <Arduino.h>
#include <EgbLink.h>
#include <driver/gpio.h>
#include <esp_timer.h>

#include "board.h"

namespace st {
namespace motor {

// The motor's phases, under `lock` (buzz() runs in any task, the timer in the esp_timer task). A timer left from an
// earlier buzz that fires before the current phase's end only re-arms itself.
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static bool on = false;
static uint8_t left = 0;     // pulses still to start
static uint16_t pulseMs = 0;
static int64_t phaseEndUs = 0;
static esp_timer_handle_t timer;

static void step(void *) {
  int64_t now = esp_timer_get_time();
  int64_t next = 0;
  portENTER_CRITICAL(&lock);
  if (now + 200 < phaseEndUs) {
    next = phaseEndUs - now;
  } else if (on) {
    on = false;
    gpio_set_level((gpio_num_t)PIN_MOTOR, 0);
    if (left) {
      phaseEndUs = now + egb::BUZZ_GAP_MS * 1000;
      next = egb::BUZZ_GAP_MS * 1000;
    }
  } else if (left) {
    left--;
    on = true;
    gpio_set_level((gpio_num_t)PIN_MOTOR, 1);
    phaseEndUs = now + pulseMs * 1000;
    next = pulseMs * 1000;
  }
  portEXIT_CRITICAL(&lock);
  if (next) esp_timer_start_once(timer, (uint64_t)next);
}

void begin() {
  pinMode(PIN_MOTOR, OUTPUT);
  digitalWrite(PIN_MOTOR, LOW);
  esp_timer_create_args_t args = {};
  args.callback = step;
  args.name = "motor";
  esp_timer_create(&args, &timer);
}

void buzz(uint16_t ms, uint8_t pulses) {
  if (!ms || !pulses) return;
  portENTER_CRITICAL(&lock);
  on = true;
  left = pulses - 1;
  pulseMs = ms;
  phaseEndUs = esp_timer_get_time() + ms * 1000;
  gpio_set_level((gpio_num_t)PIN_MOTOR, 1);
  portEXIT_CRITICAL(&lock);
  esp_timer_stop(timer);
  esp_timer_start_once(timer, ms * 1000);
}

}  // namespace motor
}  // namespace st
