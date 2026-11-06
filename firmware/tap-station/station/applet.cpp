// The HaLo applet select, done by the station itself (on detection, and on `reselect`). HaLos answer one of two
// SELECTs (libhalo's order: the Arx AID, then the legacy one); a SELECT the chip doesn't answer costs a whole exchange
// (~50 ms, status 6D00 or 6A82), so the one each chip answered last goes first, and for a chip not seen yet, the one
// the last chip answered (chips come in batches). The answer is kept: the Pi's own SELECT with the same bytes, with
// nothing exchanged since, is answered from it without the chip.
#include "nfc.h"

namespace st {
namespace nfc {

using namespace egb;

struct Aid {
  uint8_t len;
  uint8_t apdu[16];
};
static const Aid AIDS[2] = {
    {16, {0x00, 0xA4, 0x04, 0x00, 0x0A, 0xA0, 0x00, 0x00, 0x09, 0x49, 0x01, 0x48, 0x61, 0x4C, 0x6F, 0x00}},  // Arx
    {13, {0x00, 0xA4, 0x04, 0x00, 0x07, 0x48, 0x11, 0x99, 0x13, 0x0E, 0x9F, 0x01, 0x00}},                    // legacy
};
constexpr uint32_t SELECT_TIMEOUT_MS = 500;
constexpr size_t REMEMBERED = 8;

// Which AID each recent chip answered (round robin), and the last chip's.
struct Remembered {
  uint8_t uidLen;
  uint8_t uid[CHIP_UID_MAX];
  uint8_t aid;
};
static Remembered memory[REMEMBERED];
static size_t nextMemory = 0;
static uint8_t lastAid = 0;

// The kept answer.
static struct {
  bool valid;
  uint8_t aid;
  uint16_t sw;
  uint16_t len;
  uint8_t resp[32];
} kept;

static uint8_t firstAid() {
  for (auto &m : memory)
    if (m.uidLen == held.chip.uidLen && !memcmp(m.uid, held.chip.uid, m.uidLen)) return m.aid;
  return lastAid;
}

static void remember(uint8_t aid) {
  lastAid = aid;
  for (auto &m : memory) {
    if (m.uidLen == held.chip.uidLen && !memcmp(m.uid, held.chip.uid, m.uidLen)) {
      m.aid = aid;
      return;
    }
  }
  Remembered &m = memory[nextMemory++ % REMEMBERED];
  m.uidLen = held.chip.uidLen;
  memcpy(m.uid, held.chip.uid, m.uidLen);
  m.aid = aid;
}

void forgetSelect() { kept.valid = false; }
uint16_t cachedSw() { return kept.valid ? kept.sw : 0; }

uint16_t select(uint32_t &us, uint32_t &waitUs) {
  forgetSelect();
  uint32_t t0 = micros();
  waitUs = 0;
  uint16_t sw = 0;
  uint8_t first = firstAid();
  for (uint8_t k = 0; k < 2; k++) {
    uint8_t i = (uint8_t)((first + k) % 2), status = 0, resp[sizeof kept.resp];
    int n = pn532.exchange(AIDS[i].apdu, AIDS[i].len, resp, sizeof resp, status, SELECT_TIMEOUT_MS);
    waitUs += pn532.lastWaitUs();
    held.talked = true;
    if (n < 2 || (status & 0x3F)) break;  // no answer from the chip: the Pi will see it on its own request
    sw = (uint16_t)(resp[n - 2] << 8 | resp[n - 1]);
    if (sw == 0x9000) {
      remember(i);
      kept = {true, i, sw, (uint16_t)n, {}};
      memcpy(kept.resp, resp, n);
      break;
    }
  }
  us = micros() - t0;
  return sw;
}

bool fromCache(const uint8_t *apdu, size_t len, NfcRes &r) {
  if (!kept.valid || len != AIDS[kept.aid].len || memcmp(apdu, AIDS[kept.aid].apdu, len)) return false;
  memcpy(r.data, kept.resp, kept.len);
  r.len = kept.len;
  return true;
}

}  // namespace nfc
}  // namespace st
