#include "press.h"

#include <driver/gpio.h>

#include <atomic>

#include "radio.h"
#include "resend.h"

namespace egb {
namespace press {

namespace {

enum MsgType : uint8_t { M_BUTTON, M_TRIGGER, M_ACK };

struct Msg {
  uint8_t type;
  uint8_t flags;
  uint32_t id;  // M_TRIGGER: the caller's ref; M_ACK: the acked id
  uint32_t atUs;
  uint8_t from[6];
};

constexpr uint32_t RELEASE_POLL_MS = 5;  // while the button is held: how often to look for its release

QueueHandle_t queue;
TaskHandle_t task;
gpio_num_t pin;
Peer peerOf;
Report report;
Button button;
std::atomic<bool> isDown{false};
volatile uint32_t lastEdgeUs = 0;
volatile bool lastLevel = true;

// A press is a fall after the button sat up for DEBOUNCE_US; bounces (on press and release) follow an edge closely.
void IRAM_ATTR onEdge() {
  uint32_t now = micros();
  bool level = gpio_get_level(pin);
  BaseType_t woke = pdFALSE;
  if (!level && lastLevel && now - lastEdgeUs > DEBOUNCE_US) {
    Msg m = {M_BUTTON, 0, 0, now, {}};
    xQueueSendFromISR(queue, &m, &woke);
  }
  lastLevel = level;
  lastEdgeUs = now;
  if (woke) portYIELD_FROM_ISR();
}

void setDown(bool d) {
  isDown = d;
  radio::setFlag(F_BTN, d);
  button(d);
}

void run(void *) {
  Slot slot = {};
  uint32_t nextId = esp_random();  // a rebooted board's first press never looks like a resend of an old one
  uint32_t ref = 0;
  for (;;) {
    uint32_t nowMs = millis();
    int32_t due = slot.dueInMs(nowMs);
    TickType_t wait = due >= 0 ? pdMS_TO_TICKS(due) : portMAX_DELAY;
    if (isDown && wait > pdMS_TO_TICKS(RELEASE_POLL_MS)) wait = pdMS_TO_TICKS(RELEASE_POLL_MS);
    Msg m;
    if (xQueueReceive(queue, &m, wait) == pdTRUE) {
      if (m.type == M_BUTTON) setDown(true);
      if (m.type == M_BUTTON || m.type == M_TRIGGER) {  // a new press replaces one still waiting for its ack
        uint32_t id = nextId++;
        ref = m.type == M_TRIGGER && m.id ? m.id : id;
        Press p;
        head(p, K_PRESS, 0);
        p.id = id;
        p.t = micros();
        uint8_t to[6];
        peerOf(to);
        slot.start(&p, sizeof p, to, POLICY_PACKET, millis(), p.t);
        radio::send(to, slot.buf, slot.len);
        report({Outcome::STARTED, ref, p.t, 0, 1, 0, {}});
      } else if (m.type == M_ACK && slot.used && m.id == slot.id) {
        slot.used = false;
        Outcome o = {Outcome::ACKED, ref, slot.startUs, m.atUs - slot.startUs, slot.sends, m.flags, {}};
        memcpy(o.peer, m.from, 6);
        report(o);
      }
    }
    switch (slot.poll(millis())) {
      case Slot::SEND:
        radio::send(slot.to, slot.buf, slot.len);
        break;
      case Slot::EXPIRED:
        report({Outcome::FAILED, ref, slot.startUs, 0, slot.sends, 0, {}});
        break;
      default:
        break;
    }
    // Released once the line has sat high for RELEASE_US (not latency-critical, so polled while held).
    if (isDown && gpio_get_level(pin) && micros() - lastEdgeUs >= RELEASE_US) {
      setDown(false);
      Release r;
      head(r, K_RELEASE, 0);
      uint8_t to[6];
      peerOf(to);
      radio::send(to, &r, sizeof r);
    }
  }
}

}  // namespace

void begin(uint8_t p, Peer peer, Report r, Button b) {
  pin = (gpio_num_t)p;
  peerOf = peer;
  report = r;
  button = b;
  queue = xQueueCreate(8, sizeof(Msg));
  pinMode(p, INPUT_PULLUP);
  lastLevel = digitalRead(p);
  xTaskCreate(run, "press", 3072, nullptr, configMAX_PRIORITIES - 3, &task);
  attachInterrupt(p, onEdge, CHANGE);
}

void trigger(uint32_t ref) {
  Msg m = {M_TRIGGER, 0, ref, 0, {}};
  xQueueSend(queue, &m, 0);
}

void onAck(uint32_t id, uint32_t nowUs, uint8_t flags, const uint8_t from[6]) {
  Msg m = {M_ACK, flags, id, nowUs, {}};
  memcpy(m.from, from, 6);
  xQueueSend(queue, &m, 0);
}

bool down() { return isDown; }

UBaseType_t stackLeft() { return task ? uxTaskGetStackHighWaterMark(task) : 0; }

}  // namespace press
}  // namespace egb
