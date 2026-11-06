// The receiver: an ESP32-C3 on the Pi's USB that links up to four tap stations (ESP-NOW) to one serial line of JSON
// (protocol.md). LED A (GPIO12) is toggled by any station's BOOT; the receiver's BOOT (GPIO9) toggles the first linked
// station's LED; LED B (GPIO13) stays off.
//
// Tasks: the Wi-Fi task runs the radio callback (rx.cpp: the answers that can't wait); the press task sends this
// board's presses (egb/press); the USB event task says when bytes arrive. The loop task owns the rest and sleeps on
// its inbox until one of them has news or a resend falls due.
#include <EgbLink.h>
#include <WiFi.h>
#include <esp_mac.h>

#include <atomic>

#include "events.h"
#include "loop.h"
#include "rx.h"

namespace rcv {

constexpr uint8_t PIN_BUTTON = 9;  // BOOT; free to read once the board has booted
constexpr size_t INPUT_MAX = 640;  // the longest line from the Pi: an `nfc … apdu` with a 255-byte APDU
constexpr size_t RX_BUFFER = 2048;
constexpr size_t TX_BUFFER = 2048;
constexpr uint32_t IDLE_WAIT_MS = 100;  // with nothing due: the link timeouts are checked this often

egb::Stations stations;
egb::Pool<SLOTS> slots;
static char out[OUT_MAX];
egb::Json json(out, sizeof out);
static QueueHandle_t inbox;
static egb::LineReader<INPUT_MAX> input;

void inboxBegin() { inbox = xQueueCreate(24, sizeof(Msg)); }
static std::atomic<uint32_t> drops{0};
bool post(const Msg &m) {
  if (xQueueSend(inbox, &m, 0) == pdTRUE) return true;
  drops++;
  return false;
}
uint32_t inboxDrops() { return drops; }
bool next(Msg &m, uint32_t ms) { return xQueueReceive(inbox, &m, pdMS_TO_TICKS(ms)) == pdTRUE; }

void emit(size_t n) {
  if (n) egb::serial::line(json.text(), n);
}

static void onInput() {
  static Msg m;  // only the USB event task posts INPUT
  m.type = Msg::SERIAL_IN;
  post(m);
}

static void onPressOutcome(const egb::press::Outcome &o) {
  static Msg m;  // only the press task posts PRESS and BUTTON
  m.type = Msg::PRESS;
  m.press = o;
  post(m);
}

static void onButton(bool down) {
  static Msg m;
  m.type = Msg::BUTTON;
  m.down = down;
  post(m);
}

// Every line from the Pi gets at least one line back (protocol.md), apart from the board's own output echoed back
// by a fresh tty (egb/lines.h), which carries no command and is dropped without an answer: answering it would only
// be echoed again.
static void readInput() {
  static Command cmd;
  while (Serial.available() > 0) {
    if (!input.feed((char)Serial.read())) continue;
    const egb::Line &l = input.line();
    if (l.tooLong) {
      emit(evBad(json, "line too long", ""));
      continue;
    }
    const char *text = egb::unglue(l, COMMAND_WORDS, COMMAND_COUNT);
    if (!text || (!l.junkEnd && !l.len)) continue;  // echo, or an empty line
    onCommand(parse(text, cmd), text);
  }
}

static void handle(const Msg &m) {
  switch (m.type) {
    case Msg::PACKET:
      onPacket(m);
      break;
    case Msg::PRESS:
      onPress(m.press);
      break;
    case Msg::BUTTON:
      emit(evButton(json, "c3", nullptr, m.down));
      break;
    case Msg::SERIAL_IN:
      break;  // read below, after the queue
  }
}

}  // namespace rcv

using namespace rcv;

void setup() {
  inboxBegin();
  egb::serial::begin(RX_BUFFER, TX_BUFFER, onInput);
  ledBegin();
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  egb::radio::setFlag(egb::F_RECEIVER, true);  // in every packet from here: stations ignore each other's
  if (!egb::radio::begin(onRecv)) {
    for (;;) {  // nothing works without the radio: say so until someone looks
      emit(evBad(json, "esp-now did not start", ""));
      delay(1000);
    }
  }
  setPressPeer(egb::radio::BROADCAST);
  egb::press::begin(PIN_BUTTON, pressPeer, onPressOutcome, onButton);
  emit(evReady(json, mac, egb::FW_VERSION));
}

void loop() {
  static Msg m;  // too big for the stack; only the loop task uses it
  uint32_t now = millis();
  int32_t due = slots.dueInMs(now);
  if (next(m, due >= 0 && due < (int32_t)IDLE_WAIT_MS ? (uint32_t)due : IDLE_WAIT_MS)) {
    do handle(m);
    while (next(m, 0));
  }
  readInput();
  now = millis();
  pollSlots(now);
  checkLinks(now);
}
