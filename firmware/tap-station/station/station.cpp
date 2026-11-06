// A tap station (01Space ESP32-S3 0.42" OLED board): a PN532 reader, a vibration motor, an RGB LED and a 72x40 OLED,
// linked to the Pi's receiver over ESP-NOW (protocol.md). A chip on the reader buzzes the motor at once, turns the LED
// blue and reaches the Pi as a tap; the Pi can buzz the motor, put words on the OLED and use the reader for APDUs.
//
// Tasks: the Wi-Fi task runs the radio callback (link.cpp: the answers that can't wait); the NFC task (reader.cpp)
// owns the PN532; the OLED task draws and blinks; the press task sends this board's BOOT presses (egb/press). The loop
// task, here, owns the resend slots, the pings, the stats and the station's own serial port, and sleeps on its inbox
// until one of them has news or something falls due.
#include <EgbLink.h>
#include <esp_mac.h>

#include <atomic>

#include "board.h"
#include "cli.h"
#include "led.h"
#include "link.h"
#include "loop.h"
#include "motor.h"
#include "oled.h"
#include "reader.h"
#include "stats.h"

namespace st {

Shared feedback;

static QueueHandle_t inbox;
static egb::Pool<16> slots;  // taps, gones and signatures until their Got
static egb::LineReader<64> input;
static bool radioOk;

static std::atomic<uint32_t> inboxDrops{0};

void loopPost(const LoopMsg &m) {
  if (xQueueSend(inbox, &m, 0) != pdTRUE) inboxDrops++;
}

egb::StatsRes stats() {
  egb::StatsRes r;
  egb::head(r, egb::K_STATS_RES, 0);
  r.upMs = millis();
  r.dropped = egb::serial::dropped() + inboxDrops;
  r.sendFails = egb::radio::sendFails();
  r.stack[egb::T_LOOP] = (uint16_t)uxTaskGetStackHighWaterMark(nullptr);
  r.stack[egb::T_NFC] = (uint16_t)reader::stackLeft();
  r.stack[egb::T_OLED] = (uint16_t)oled::stackLeft();
  r.stack[egb::T_PRESS] = (uint16_t)egb::press::stackLeft();
  return r;
}

static void onInput() {
  static LoopMsg m;  // only the USB event task posts INPUT
  m.type = LoopMsg::SERIAL_IN;
  loopPost(m);
}

static void onPress(const egb::press::Outcome &o) {
  static LoopMsg m;  // only the press task posts PRESS
  m.type = LoopMsg::PRESS;
  m.press = o;
  loopPost(m);
}

static void onButton(bool) {}  // the button's state rides in every packet's flags

// How this board's press went: to the receiver as a report (so the Pi sees both directions), and on our serial.
static void report(const egb::press::Outcome &o) {
  if (o.what == egb::press::Outcome::STARTED) return;
  bool acked = o.what == egb::press::Outcome::ACKED;
  egb::Report r;
  egb::head(r, egb::K_REPORT, 0);
  r.id = o.ref;
  r.rttUs = acked ? o.rttUs : 0;
  r.sends = o.sends;
  link::send(&r, sizeof r);
  char line[64];
  snprintf(line, sizeof line, "press id=%lu %s rtt_us=%lu tries=%u\n", (unsigned long)o.ref, acked ? "acked" : "failed",
           (unsigned long)r.rttUs, o.sends);
  egb::serial::line(line, strlen(line));
}

static void handle(const LoopMsg &m) {
  switch (m.type) {
    case LoopMsg::GOT: {
      egb::Got g;
      if (egb::read(g, m.data, m.len)) slots.take(0, g.of, g.id);
      break;
    }
    case LoopMsg::STATS: {
      egb::StatsReq q;
      if (!egb::read(q, m.data, m.len)) break;
      egb::StatsRes r = stats();
      r.id = q.id;
      r.h.tries = q.h.tries;
      link::send(&r, sizeof r);
      break;
    }
    case LoopMsg::RELIABLE: {
      // Its first copy is out; resent until the Got, for as long as the Pi may wait for it.
      uint8_t to[6];
      link::receiver(to);
      slots.freeOrOldest()->start(m.data, m.len, to, egb::POLICY_CHIP_EVENT, millis(), micros());
      break;
    }
    case LoopMsg::PRESS:
      report(m.press);
      break;
    case LoopMsg::SERIAL_IN:
      break;  // read below
  }
}

}  // namespace st

using namespace st;

void setup() {
  inbox = xQueueCreate(16, sizeof(LoopMsg));
  egb::serial::begin(256, 1024, onInput);
  motor::begin();
  led::begin();
  radioOk = link::begin();
  oled::begin(radioOk);
  if (radioOk) egb::press::begin(PIN_BUTTON, link::receiver, onPress, onButton);
  reader::begin();
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char line[64];
  snprintf(line, sizeof line, "station %02x%02x%02x fw %s%s\n", mac[3], mac[4], mac[5], egb::FW_VERSION,
           radioOk ? "" : ", esp-now failed");
  egb::serial::line(line, strlen(line));
}

void loop() {
  static uint32_t nextPing = 0, seq = 0;
  static LoopMsg m;  // only the loop task uses it
  uint32_t now = millis();
  int32_t due = egb::sinceMs(nextPing, now);
  int32_t slotDue = slots.dueInMs(now);
  if (slotDue >= 0 && slotDue < due) due = slotDue;
  if (xQueueReceive(inbox, &m, pdMS_TO_TICKS(due > 0 ? due : 0)) == pdTRUE) {
    do handle(m);
    while (xQueueReceive(inbox, &m, 0) == pdTRUE);
  }
  while (Serial.available() > 0)
    if (input.feed((char)Serial.read()) && !input.line().tooLong) cli::line(input.line());
  if (!radioOk) return;
  now = millis();
  for (auto &slot : slots.slots)
    if (slot.poll(now) == egb::Slot::SEND) egb::radio::send(slot.to, slot.buf, slot.len);
  if (egb::sinceMs(now, nextPing) >= 0) {
    nextPing = now + egb::PING_MS;
    egb::Ping p;
    egb::head(p, egb::K_PING, 0);
    p.seq = ++seq;
    p.t = micros();
    p.rttUs = link::pingRttUs();
    uint8_t to[6];
    if (link::linked(now)) link::receiver(to);
    else memcpy(to, egb::radio::BROADCAST, 6);  // searching: whichever receiver hears it answers
    egb::radio::send(to, &p, sizeof p);
  }
}
