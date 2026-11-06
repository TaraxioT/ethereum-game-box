// Timing runs on the chip resting on the reader, for the station's own serial (`bench <what> [n]`): one line per run,
// the numbers in µs, for a host script to sum up (README.md, "Measured"). They run in the NFC task like a request.
//
//   bench read N     a fresh activation (field cycle + list):        list_us wait_us
//   bench rats N     list with the PN532's own RATS, without it, and RATS sent by hand: rats_us norats_us thru_us ats_len
//   bench select N   a fresh activation, then each HaLo SELECT:       arx_us arx_sw legacy_us legacy_sw
//   bench present N  the presence check:                             present_us ok
//   bench list N     `nfc list`'s parts: field cycle, list one chip, list two:  cycle_us one_us two_us found
//   bench lift       the chip leaves and lands again (the field off 100 ms): a real tap follows
#include "board.h"
#include "nfc.h"

namespace st {
namespace nfc {

using namespace egb;

static const uint8_t SELECTS[2][16] = {
    {0x00, 0xA4, 0x04, 0x00, 0x0A, 0xA0, 0x00, 0x00, 0x09, 0x49, 0x01, 0x48, 0x61, 0x4C, 0x6F, 0x00},
    {0x00, 0xA4, 0x04, 0x00, 0x07, 0x48, 0x11, 0x99, 0x13, 0x0E, 0x9F, 0x01, 0x00}};
static const uint8_t SELECT_LEN[2] = {16, 13};

static bool fresh(Chip &c, uint32_t &listUs) {
  uint8_t n = 0;
  pn532.resetField();
  uint32_t t0 = micros();
  bool ok = pn532.list(&c, 1, n) && n;
  listUs = micros() - t0;
  return ok;
}

static void line(const char *what, uint32_t a, uint32_t b, uint32_t c = 0, uint32_t d = 0) {
  char out[64];
  snprintf(out, sizeof out, "bench %s %lu %lu %lu %lu\n", what, (unsigned long)a, (unsigned long)b, (unsigned long)c,
           (unsigned long)d);
  say(out);
}

static void rats() {
  Chip c;
  uint32_t withRats, without;
  if (!fresh(c, withRats)) return;
  pn532.autoRats(false);
  bool ok = fresh(c, without);
  pn532.autoRats(true);
  if (!ok) return;
  uint8_t cmd[] = {0xE0, 0x80}, resp[32], status;  // RATS: FSD 256, CID 0
  uint32_t t0 = micros();
  int got = pn532.thru(cmd, sizeof cmd, resp, sizeof resp, status, 100);
  line("rats", withRats, without, micros() - t0, got > 0 ? resp[0] : 0);
}

static void selects() {
  Chip c;
  uint32_t us, t[2];
  uint16_t sw[2];
  if (!fresh(c, us)) return;
  for (int k = 0; k < 2; k++) {
    uint8_t resp[32], status = 0;
    uint32_t t0 = micros();
    int got = pn532.exchange(SELECTS[k], SELECT_LEN[k], resp, sizeof resp, status, 500);
    t[k] = micros() - t0;
    sw[k] = got >= 2 ? (uint16_t)(resp[got - 2] << 8 | resp[got - 1]) : 0;
  }
  line("select", t[0], sw[0], t[1], sw[1]);
}

static void listParts() {
  Chip two[2];
  uint8_t got = 0;
  uint32_t t0 = micros();
  pn532.resetField();
  uint32_t t1 = micros();
  pn532.list(two, 1, got);
  uint32_t t2 = micros();
  pn532.resetField();
  uint32_t t3 = micros();
  pn532.list(two, 2, got);
  line("list", t1 - t0, t2 - t1, micros() - t3, got);
}

void runBench(const char *what, uint16_t n) {
  if (!strcmp(what, "lift")) {  // the presence checks miss it, then the task's own read finds it as a new tap
    pn532.field(false);
    vTaskDelay(pdMS_TO_TICKS(100));
    if (feedback.chipOn) lost();
    pn532.field(true);
    return;
  }
  for (uint16_t i = 0; i < n; i++) {
    Chip c;
    uint32_t us;
    if (!strcmp(what, "read")) {
      if (fresh(c, us)) line(what, us, pn532.lastWaitUs());
    } else if (!strcmp(what, "rats")) {
      rats();
    } else if (!strcmp(what, "select")) {
      selects();
    } else if (!strcmp(what, "present")) {
      uint32_t t0 = micros();
      bool ok = pn532.present();
      line(what, micros() - t0, ok);
    } else if (!strcmp(what, "list")) {
      listParts();
    } else {
      say("bench: read | rats | select | present | list | lift\n");
      return;
    }
  }
  say("bench done\n");
  // The runs cycled the field: the chip is fresh again, as a re-read would leave it.
  Chip c;
  uint8_t got = 0;
  if (feedback.chipOn && pn532.resetField() && pn532.list(&c, 1, got) && got) found(c, micros(), 0, false);
}

}  // namespace nfc
}  // namespace st
