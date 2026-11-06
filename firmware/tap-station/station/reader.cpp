// The NFC task: finding the PN532, reading chips, watching a resting chip, and the Pi's requests in between.
//
// A read (one InListPassiveTarget, one activation try, so no chip is a quick miss) leaves the chip it found halted,
// and a halted chip ignores the next read: a resting chip needs another way to show it's still there, or it reads as
// lifted 33 ms after it landed. An ISO-DEP chip (a HaLo) gets a presence check every PRESENCE_MS that leaves it
// selected, so the Pi's APDUs carry on (Pn532::present(), an R(NAK): ~4.3 ms); any other chip, or one that doesn't
// answer the check, is read again after a short field cycle (~40 ms). Some HaLos stop answering R(NAK) even after a
// block was exchanged (one with SAK 28 did, right after the station's own select): such a chip is re-read too, never
// counted gone for a missed check alone. For QUIET_MS
// after a request there are no checks at all: the Pi is mid-session, and the chip's own answers show it's there.
#include "reader.h"

#include <Wire.h>

#include "board.h"
#include "led.h"
#include "link.h"
#include "motor.h"
#include "nfc.h"
#include "oled.h"
#include "timing.h"

namespace st {
namespace nfc {

std::atomic<uint32_t> busyId{0};
Pn532 pn532(Wire1, PIN_NFC_SDA, PIN_NFC_SCL, PIN_NFC_IRQ);
Held held;

constexpr uint8_t GONE_MISSES = 2;        // checks in a row without the chip before it counts as lifted
constexpr uint32_t QUIET_MS = 150;
constexpr uint16_t TAP_BUZZ_MS = 80;
constexpr uint16_t NOPE_BUZZ_MS = 35;     // two of them: an unwelcome tap
constexpr uint8_t SILENT_LISTS = 3;       // reads in a row the PN532 didn't answer before it's checked as lost
constexpr uint32_t REBOOT_AFTER_MS = 3000;  // a PN532 that worked this boot and won't come back: restart the S3

static uint32_t lastStartUs = 0;  // when the last detection started (for a new tap's gap_us)

void say(const char *line) { egb::serial::line(line, strlen(line)); }

static void sayTap(const egb::Chip &c, uint32_t readUs) {
  char uid[2 * egb::CHIP_UID_MAX + 1] = {};
  egb::hexOut(uid, c.uid, c.uidLen);
  char line[64];
  snprintf(line, sizeof line, "tag uid=%s sak=%02X read_us=%lu\n", uid, c.sak, (unsigned long)readUs);
  say(line);
}

bool found(const egb::Chip &c, uint32_t startUs, uint32_t gapUs, bool poll) {
  bool on = feedback.chipOn;
  held.misses = 0;
  held.talked = false;
  held.pristine = true;
  forgetSelect();
  if (on && c.sameAs(held.chip)) {
    held.chip = c;
    return false;
  }
  // On the station, at once: no round trip. A tap the Pi's screen says isn't welcome gets NOT NOW and two short buzzes
  // here and now; it still goes to the Pi, which decides what it means.
  bool nope = feedback.mode == MODE_SHUT;
  if (nope) motor::buzz(NOPE_BUZZ_MS, 2);
  else motor::buzz(TAP_BUZZ_MS);
  if (on) {
    egb::Gone g;
    egb::head(g, egb::K_GONE, 0);
    g.id = held.tapId;
    g.boot = held.boot;
    g.chip = held.chip;
    link::sendReliable(&g, sizeof g);
  }
  held.chip = c;
  held.deaf = false;
  held.detectedUs = startUs;
  egb::Tap t;
  egb::head(t, egb::K_TAP, 0);
  t.id = ++held.tapId;
  t.boot = held.boot;
  t.gapUs = gapUs;
  t.chip = c;
  t.readUs = micros() - startUs;
  link::sendReliable(&t, sizeof t);
  uint32_t now = millis();
  feedback.detectedMs = now;
  feedback.activeMs = now;
  feedback.goodMs = 0;
  feedback.phase = PH_DETECTED;
  feedback.tooSoon = false;
  feedback.nope = nope;
  feedback.chipOn = true;
  feedback.taps = feedback.taps + 1;
  led::show();
  oled::poke();
  sayTap(c, t.readUs);
  // The HaLo applet, now that the tap is out: by the time the Pi's own SELECT arrives the chip has answered it, and it
  // gets that answer at once (applet.cpp). Measured against putting the answer in the tap (the tap ~23 ms later) and
  // leaving it to the Pi, it's as fast to the applet as the first and as fast to the tap as the second.
  if (poll && c.isoDep()) {
    uint32_t us, waitUs;
    bool good = select(us, waitUs) == 0x9000;
    feedback.activeMs = millis();
    if (good) {  // a good read, as the Pi's own select was: DONE follows if nothing more comes (feedback.h)
      feedback.goodMs = feedback.activeMs.load();
      feedback.phase = PH_READING;
    }
  }
  return true;
}

void lost() {
  uint32_t now = millis();
  Snapshot s = feedback.snap();
  feedback.liftedMs = now;
  // Lifted mid-sign, or between a failed sign and the Pi's retry (a failure already shown stays AGAIN).
  feedback.tooSoon = s.phase == PH_SIGNING || (s.phase == PH_FAILED && !failShown(s, now));
  feedback.chipOn = false;
  egb::Gone g;
  egb::head(g, egb::K_GONE, 0);
  g.id = held.tapId;
  g.boot = held.boot;
  g.chip = held.chip;
  link::sendReliable(&g, sizeof g);
  forgetSelect();
  // A chip still on the reader after a gone (two re-reads missed it) stays in its active ISO-DEP state and ignores the
  // activation a plain list sends; a field cycle lets it come back as a fresh tap instead of never.
  pn532.resetField();
  lastStartUs = micros();
  led::show();
  oled::poke();
  say("tag gone\n");
}

}  // namespace nfc

namespace reader {

using namespace nfc;

struct Request {
  uint8_t from[6];
  egb::NfcReq q;
};

constexpr uint8_t OP_BENCH = 0xF0;  // the CLI's timing runs, queued like a request so they run in this task

static QueueHandle_t requests;
static TaskHandle_t task;

void request(const egb::NfcReq &q, const uint8_t from[6]) {
  if (q.id == busyId) return;  // still on it
  static Request r;            // only the Wi-Fi task calls this
  memcpy(r.from, from, 6);
  memcpy(&r.q, &q, egb::sizeOf(q));
  busyId = q.id;
  if (xQueueSend(requests, &r, 0) != pdTRUE) busyId = 0;  // full: the next resend tries again
}

static void lookForReader(uint32_t now, uint32_t &nextFind, uint32_t lostMs, bool &worked) {
  static bool told = false;
  if (egb::sinceMs(now, nextFind) < 0) return;
  nextFind = now + 1000;
  Pn532::Bus bus = pn532.restartBus();
  feedback.sclStuck = bus == Pn532::BUS_SCL_STUCK;
  if (pn532.begin()) {
    told = false;
    worked = true;
    lastStartUs = micros();  // the detections start now
    feedback.nfcOk = true;
    egb::radio::setFlag(egb::F_NFC, true);
    char line[64];
    snprintf(line, sizeof line, "pn532 firmware %lu.%lu, irq %s\n", (unsigned long)(pn532.firmware() >> 16 & 0xff),
             (unsigned long)(pn532.firmware() >> 8 & 0xff), pn532.irqWired() ? "wired" : "not wired");
    say(line);
  } else {
    if (!told) say(bus == Pn532::BUS_SCL_STUCK ? "pn532 holds SCL low: replug the station\n" : "pn532 not answering\n");
    told = true;
    // Once it went silent with the bus idle and re-opening the bus didn't wake it, though a reset of this board did.
    // A held SCL needs a power cycle instead (the OLED says so), and a PN532 that never answered is left alone.
    if (worked && bus != Pn532::BUS_SCL_STUCK && egb::sinceMs(now, lostMs) >= (int32_t)REBOOT_AFTER_MS) {
      say("pn532 still silent: restarting\n");
      esp_restart();
    }
  }
  oled::poke();
}

static void run(void *) {
  uint32_t nextFind = 0, lostMs = 0;
  uint8_t silent = 0;
  bool worked = false;
  held.tapId = esp_random();  // tap ids count up from here, named by this boot's number
  held.boot = esp_random();
  static Request r;
  for (;;) {
    uint32_t now = millis();
    if (!feedback.nfcOk) {
      if (xQueueReceive(requests, &r, pdMS_TO_TICKS(10)) != pdTRUE) lookForReader(millis(), nextFind, lostMs, worked);
      else if (r.q.op == OP_BENCH) say("bench: no reader\n");
      else serve(r.q, r.from);  // answered: no reader
      continue;
    }
    bool on = feedback.chipOn;
    if (xQueueReceive(requests, &r, pdMS_TO_TICKS(on ? PRESENCE_MS : 1)) == pdTRUE) {
      if (r.q.op == OP_BENCH) runBench((const char *)r.q.data, r.q.len);
      else serve(r.q, r.from);
      if (!feedback.chipOn) lastStartUs = micros();  // the next look starts the window afresh
      continue;
    }
    now = millis();
    if (on && egb::sinceMs(now, held.servedMs) < (int32_t)QUIET_MS) continue;
    bool there = false, cycle = !on || !held.chip.isoDep() || held.deaf;
    if (!cycle) {
      there = pn532.present();
      if (!there) held.deaf = cycle = true;  // it doesn't answer the check: re-read it, now and from here on
    }
    if (cycle) {
      if (on) {
        pn532.resetField();
        forgetSelect();
      }
      egb::Chip c;
      uint8_t n = 0;
      uint32_t start = micros();
      bool answered = pn532.list(&c, 1, n, nullptr, 0, READ_TIMEOUT_MS);
      silent = answered ? 0 : silent + 1;
      there = answered && n;
      uint32_t gap = gapUs(start, lastStartUs);
      lastStartUs = start;
      if (there) found(c, start, gap, true);
    }
    if (there) {
      held.misses = 0;
    } else if (on && ++held.misses >= GONE_MISSES) {
      lost();
    }
    // A PN532 that stops answering (unplugged) fails its reads; a few in a row and a failed firmware read confirm it.
    if (!feedback.chipOn && silent >= SILENT_LISTS) {
      silent = 0;
      if (!pn532.begin()) {
        feedback.nfcOk = false;
        egb::radio::setFlag(egb::F_NFC, false);
        lostMs = now;
        nextFind = now + 2000;
        say("pn532 lost\n");
        oled::poke();
      }
    }
  }
}

void begin() {
  requests = xQueueCreate(3, sizeof(Request));
  // Above the loop and the OLED, on the core the Wi-Fi task doesn't use; its waits sleep, so nothing starves.
  xTaskCreatePinnedToCore(run, "nfc", 6144, nullptr, 5, &task, 1);
}

uint32_t stackLeft() { return task ? uxTaskGetStackHighWaterMark(task) : 0; }

void bench(const char *what, uint16_t n) {
  static Request r;  // only the loop task calls this
  memset(&r, 0, sizeof r);
  r.q.op = OP_BENCH;
  r.q.len = n;
  strncpy((char *)r.q.data, what, sizeof r.q.data - 1);
  xQueueSend(requests, &r, 0);
}

}  // namespace reader
}  // namespace st
