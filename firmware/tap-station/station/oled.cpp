#include "oled.h"

#include <U8g2lib.h>
#include <Wire.h>

#include "board.h"
#include "led.h"
#include "link.h"
#include "screen_draw.h"

namespace st {
namespace oled {

constexpr uint32_t BIT_POKE = 1, BIT_FRAME = 2;
constexpr uint32_t SCREEN_LINK_LOSS_MS = 3000;  // the Pi's screen is dropped this long after the link went
constexpr uint32_t IDLE_WAKE_MS = 500;          // with nothing moving: the link dot and the ttl are checked this often

static U8G2_SSD1306_72X40_ER_F_HW_I2C display(U8G2_R0, U8X8_PIN_NONE);
static TaskHandle_t task;
static QueueHandle_t mailbox;  // the newest screen from the Pi
static bool radioUp;

// The Pi's screen: owned by this task.
static ScreenSpec spec;
static bool haveSpec = false;
static uint32_t specId = 0, specMs = 0, specVersion = 0;
static uint8_t specRaw[egb::SCREEN_MAX], specRawLen = 0;

void poke() {
  if (task) xTaskNotify(task, BIT_POKE, eSetBits);
}

void screenIn(const egb::Screen &s) {
  xQueueOverwrite(mailbox, &s);
  poke();
}

void frame() {
  if (task) xTaskNotify(task, BIT_FRAME, eSetBits);
}

uint32_t stackLeft() { return task ? uxTaskGetStackHighWaterMark(task) : 0; }

// The Pi's screen changed: redraw, and a result still showing gives way to it (feedback.h).
static void newScreen(uint32_t now) {
  specVersion++;
  feedback.screenMs = now;
  feedback.screenSet = true;
}

// Takes the Pi's newest screen, and drops the one shown once its ttl is up or the link has been gone a while (the Pi
// sends it again on relink). The Pi resends the same screen every few seconds: a repeat only renews its ttl.
static void takeScreen(uint32_t now) {
  static egb::Screen s;
  if (xQueueReceive(mailbox, &s, 0) == pdTRUE && s.id != specId) {
    specId = s.id;
    specMs = now;
    if (haveSpec && s.len == specRawLen && !memcmp(s.data, specRaw, s.len)) return;
    screenParse(s.data, s.len, spec);
    memcpy(specRaw, s.data, s.len);
    specRawLen = s.len;
    haveSpec = true;
    newScreen(now);
    return;
  }
  if (!haveSpec) return;
  bool expired = spec.ttlS && egb::sinceMs(now, specMs) >= (int32_t)(spec.ttlS * 1000);
  bool gone = egb::sinceMs(now, link::heardMs()) > (int32_t)SCREEN_LINK_LOSS_MS &&
              egb::sinceMs(now, specMs) > (int32_t)SCREEN_LINK_LOSS_MS;
  if (!expired && !gone) return;
  memset(&spec, 0, sizeof spec);
  haveSpec = false;
  specRawLen = 0;
  newScreen(now);
}

static ScreenView viewFor(const Snapshot &s, const Shown &v, uint32_t now) {
  static const char *const BIG[FB_COUNT] = {"HOLD", "HOLD STILL", "DONE", "AGAIN"};
  static const char *const SMALL[FB_COUNT] = {"reading", "signing", "", "tap again"};
  ScreenView w;
  memset(&w, 0, sizeof w);  // compared whole with memcmp, padding included
  w.look = v.look;
  w.tag = spec.tag;
  w.linked = link::linked(now);
  w.led = led::mine();
  w.sweep = v.sweep;
  if (!radioUp) {  // nothing from the Pi can reach a station without its radio
    w.look = LOOK_FAULT;
    w.big = "NO RADIO";
    w.small = "esp-now failed";
    w.tag = "";
  } else if (v.look == LOOK_FAULT) {  // the reader's trouble is local, and nothing from the Pi hides it
    w.big = s.sclStuck ? "REPLUG" : "NO READER";
    w.small = s.sclStuck ? "reader hung" : "check wiring";
    w.tag = "";
  } else if (v.look == LOOK_IDLE) {
    w.big = spec.idle.given ? spec.idle.big : "TAP";
    w.small = spec.idle.small;
  } else if (spec.feedback[v.fb].given) {
    w.big = spec.feedback[v.fb].big;
    w.small = spec.feedback[v.fb].small;
  } else {
    w.big = v.soon ? "TOO SOON" : BIG[v.fb];
    w.small = SMALL[v.fb];
  }
  return w;
}

// Sends the 8-pixel rows that differ from what the panel shows, each run of them in one go: a whole frame is ~9 ms of
// I2C, and most changes touch one row (the link dot or the LED square the top one, a sweep step the bottom one).
static void sendChangedRows() {
  constexpr int ROWS = SCREEN_H / 8;
  static uint8_t panel[ROWS * SCREEN_W];
  static bool known = false;
  const uint8_t *buf = display.getBufferPtr();
  auto same = [&](int row) { return known && !memcmp(buf + row * SCREEN_W, panel + row * SCREEN_W, SCREEN_W); };
  for (int row = 0; row < ROWS;) {
    if (same(row)) {
      row++;
      continue;
    }
    int end = row + 1;
    while (end < ROWS && !same(end)) end++;
    display.updateDisplayArea(0, row, SCREEN_W / 8, end - row);
    row = end;
  }
  memcpy(panel, buf, sizeof panel);
  known = true;
}

// The buffer row-major, one bit a pixel, most significant first (U8g2 keeps it in 8-pixel columns).
static void printFrame() {
  static char line[12 + SCREEN_W * SCREEN_H / 4 + 2] = "frame 72 40 ";
  const uint8_t *buf = display.getBufferPtr();
  size_t n = 12;
  for (int y = 0; y < SCREEN_H; y++) {
    for (int x = 0; x < SCREEN_W; x += 8) {
      uint8_t b = 0;
      for (int k = 0; k < 8; k++) b = (uint8_t)(b << 1 | ((buf[(y / 8) * SCREEN_W + x + k] >> (y % 8)) & 1));
      n += egb::hexOut(line + n, &b, 1);
    }
  }
  line[n++] = '\n';
  egb::serial::lineWaiting(line, n, 50);  // only a host that asked is reading
}

static void run(void *) {
  struct Drawn {
    ScreenView v;
    uint32_t specVersion;
  } drawn = {}, now = {};
  bool first = true;
  uint32_t wait = 0;
  for (;;) {
    uint32_t bits = 0;
    xTaskNotifyWait(0, UINT32_MAX, &bits, pdMS_TO_TICKS(wait));
    uint32_t t = millis();
    takeScreen(t);
    led::show();  // the blink
    Snapshot s = feedback.snap();
    Shown v = shown(s, t, led::mine());
    now.v = viewFor(s, v, t);
    now.specVersion = specVersion;
    bool changed = first || memcmp(&now.v, &drawn.v, sizeof now.v) || now.specVersion != drawn.specVersion;
    if (changed) {
      drawScreen(display.getU8g2(), now.v);
      sendChangedRows();
      drawn = now;
      first = false;
    }
    if (bits & BIT_FRAME) printFrame();
    int32_t next = nextChangeMs(s, t);
    wait = next >= 0 && next < (int32_t)IDLE_WAKE_MS ? (uint32_t)next : IDLE_WAKE_MS;
  }
}

void begin(bool radioOk) {
  radioUp = radioOk;
  mailbox = xQueueCreate(1, sizeof(egb::Screen));
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  display.setBusClock(400000);
  display.begin();
  display.setContrast(255);
  // Core 0 at the lowest priority: it draws while the Wi-Fi task is idle and never competes with the NFC task.
  xTaskCreatePinnedToCore(run, "oled", 4096, nullptr, 1, &task, 0);
}

}  // namespace oled
}  // namespace st
