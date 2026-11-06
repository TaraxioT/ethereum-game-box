// The Pi's requests for the reader, run in the NFC task between its own checks. The reply goes out before anything
// else (the LED, the log, the `signed` packet): the Pi is waiting on it.
#include "board.h"
#include "led.h"
#include "link.h"
#include "motor.h"
#include "nfc.h"
#include "oled.h"

namespace st {
namespace nfc {

using namespace egb;

constexpr uint32_t ACTIVATE_TIMEOUT_MS = 60;
constexpr uint16_t SIGNED_BUZZ_MS = 60;  // two short pulses: the signature is back

static NfcRes reply;      // the last reply, sent again for a resend of its request
static uint8_t replyTo[6];
static uint32_t doneId = 0;

// The field off and on, then one look for chips; a slow activation gets a second try before the reader counts as
// not answering.
static bool activate(Chip *t, uint8_t max, uint8_t &n, const uint8_t *uid, uint8_t uidLen) {
  for (int attempt = 0; attempt < 2; attempt++)
    if (pn532.resetField() && pn532.list(t, max, n, uid, uidLen, ACTIVATE_TIMEOUT_MS)) return true;
  return false;
}

// apdu / sign. A sign request is timed on the reader alone (`chipUs`) for the `signed` packet.
static void apdu(const NfcReq &q, NfcRes &r, bool &signing, bool &signedOk, uint32_t &chipUs) {
  if (!q.len) {
    r.err = ERR_BAD;
    return;
  }
  if (!feedback.chipOn || !held.chip.isoDep()) {
    r.err = ERR_NO_CHIP;
    return;
  }
  if (q.op == OP_APDU && fromCache(q.data, q.len, r)) {  // the chip's answer to this very SELECT, a moment ago
    feedback.phase = PH_READING;
    held.lastApduMs = millis();
    return;
  }
  signing = q.op == OP_SIGN;
  feedback.phase = signing ? PH_SIGNING : PH_READING;
  if (signing) {  // HOLD STILL while it runs
    led::show();
    oled::poke();
  }
  held.talked = true;
  held.pristine = false;
  forgetSelect();
  uint8_t status = 0;
  uint32_t x0 = micros();
  int n = pn532.exchange(q.data, q.len, r.data, NFC_DATA_MAX, status);
  chipUs = micros() - x0;
  r.waitUs = pn532.lastWaitUs();
  bool ok = n >= 0 && !(status & 0x3F);
  held.lastApduMs = ok ? millis() : 0;  // a failed read isn't "done"
  if (signing) {
    signedOk = ok && n >= 2 && (r.data[n - 2] == 0x90 || r.data[n - 2] == 0x91) && r.data[n - 1] == 0x00;
    if (signedOk) {
      feedback.phase = PH_SIGNED;
      motor::buzz(SIGNED_BUZZ_MS, 2);
    } else {
      feedback.failedMs = millis();
      feedback.phase = PH_FAILED;
    }
  }
  if (n < 0) {
    r.err = ERR_RF;
    r.pn532 = 0xFF;  // the PN532 itself didn't answer in time
  } else if (status & 0x3F) {
    r.err = ERR_RF;
    r.pn532 = status;
  } else {
    r.len = (uint16_t)n;
  }
}

// reselect / select / list: the chips that answered, as Chip[].
static void tags(const NfcReq &q, NfcRes &r, uint32_t t0) {
  Chip t[2];
  uint8_t n = 0;
  bool reused = false;
  if (q.op == OP_SELECT && (!q.len || q.len > CHIP_UID_MAX)) {
    r.err = ERR_BAD;
    return;
  }
  if (q.op == OP_RESELECT && feedback.chipOn && held.chip.isoDep() && held.pristine && pn532.present()) {
    // Nothing has talked to it since it was found: a field cycle would only power it off and find it again (~40 ms).
    t[0] = held.chip;
    n = 1;
    reused = true;
  } else if (!activate(t, q.op == OP_LIST ? 2 : 1, n, q.op == OP_SELECT ? q.data : nullptr, (uint8_t)q.len)) {
    r.err = ERR_NO_READER;
    return;
  }
  r.waitUs = pn532.lastWaitUs();
  if (!n) {
    if (q.op != OP_LIST) r.err = ERR_NO_TAG;  // a held chip that didn't answer is left to the presence checks
    return;
  }
  if (!reused) found(t[0], t0, 0, false);
  if (q.op == OP_RESELECT && t[0].isoDep()) {
    uint32_t us, waitUs = 0;
    r.sel = reused && cachedSw() ? cachedSw() : select(us, waitUs);
    r.waitUs += waitUs;
  }
  r.len = (uint16_t)(n * sizeof(Chip));
  memcpy(r.data, t, r.len);
}

void serve(const NfcReq &q, const uint8_t from[6]) {
  if (q.id == doneId) {  // the reply got lost: the same one again
    if (busyId == q.id) busyId = 0;
    radio::send(replyTo, &reply, sizeOf(reply));
    return;
  }
  NfcRes &r = reply;
  head(r, K_NFC_RES, 0);
  r.id = q.id;
  r.op = q.op;
  bool signing = false, signedOk = false;
  uint32_t chipUs = 0, t0 = micros();
  if (!feedback.nfcOk) r.err = ERR_NO_READER;
  else if (q.op == OP_APDU || q.op == OP_SIGN) apdu(q, r, signing, signedOk, chipUs);
  else if (q.op == OP_RESELECT || q.op == OP_SELECT || q.op == OP_LIST) tags(q, r, t0);
  else r.err = ERR_BAD;
  r.us = micros() - t0;
  if (!r.err) held.servedMs = millis();  // only an answer from the chip shows it's there
  memcpy(replyTo, from, 6);
  doneId = q.id;
  if (busyId == q.id) busyId = 0;
  radio::send(from, &r, sizeOf(r));
  if (!signing) return;
  led::show();  // green, or the fast blink while the Pi retries
  oled::poke();
  Signed p;
  head(p, K_SIGNED, 0);
  p.id = q.id;
  p.tap = held.tapId;
  p.chipUs = chipUs;
  p.totalUs = micros() - held.detectedUs;
  p.ok = signedOk;
  p.chip = held.chip;
  link::sendReliable(&p, sizeof p);
  char line[64];
  snprintf(line, sizeof line, "sign %s chip_us=%lu total_us=%lu\n", signedOk ? "ok" : "failed", (unsigned long)chipUs,
           (unsigned long)p.totalUs);
  say(line);
}

}  // namespace nfc
}  // namespace st
