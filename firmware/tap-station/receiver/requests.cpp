// The Pi's commands, and the requests they start: each goes to its station in a resend slot, under a wire id of the
// receiver's own (so a Pi that restarts and reuses an id can't be taken for a resend), and the slot keeps the caller's
// id for the answer.
#include "events.h"
#include "loop.h"
#include "rx.h"

namespace rcv {

using namespace egb;

static uint32_t wireId = esp_random();  // a rebooted receiver's first request never looks like a resend

// Sends a packet in a slot for station `si`; `replace` reuses the station's slot of that kind (one NFC request and one
// screen in flight per station: a newer one takes over, and the old one gets no line). False with every slot busy.
template <class T> static bool start(int si, T &p, size_t len, Policy policy, uint32_t ref, bool replace) {
  Station &s = stations.at[si];
  Slot *slot = replace ? slots.find((uint8_t)si, p.h.kind) : nullptr;
  if (!slot) slot = slots.free();
  if (!slot) return false;
  slot->start(&p, len, s.mac, policy, millis(), micros());
  slot->station = (uint8_t)si;
  slot->ref = ref;
  radio::addPeer(s.mac);
  radio::send(s.mac, slot->buf, slot->len);
  return true;
}

// buzz / screen to one station or `all`: one answer per station, or one fail when none is linked.
static void toStations(const Command &c, const char *failEv, const char *line) {
  uint32_t now = millis();
  bool any = false;
  for (int i = 0; i < MAX_STATIONS; i++) {
    if (!stations.linked(i, now) || (strcmp(c.st, "all") && strcmp(c.st, stations.at[i].name))) continue;
    any = true;
    bool ok;
    if (c.type == C_BUZZ) {
      Buzz b;
      head(b, K_BUZZ, 0);
      b.id = wireId++;
      b.ms = c.ms;
      b.pulses = c.pulses;
      ok = start(i, b, sizeof b, POLICY_PACKET, c.id, false);
    } else {
      static Screen p;  // only the loop task uses it
      head(p, K_SCREEN, 0);
      p.id = wireId++;
      p.len = (uint8_t)c.len;
      memcpy(p.data, c.data, c.len);
      ok = start(i, p, sizeOf(p), POLICY_SCREEN, c.id, true);
    }
    if (!ok) emit(evFail(json, failEv, stations.at[i].name, c.id, "busy"));
  }
  if (!any) emit(evNoStation(json, failEv, c.st, c.id, line));
}

static void nfc(const Command &c) {
  int si = stations.linkedNamed(c.st, millis());
  if (si < 0) {
    emit(evFail(json, "nfc_fail", c.st, c.id, "no such station linked"));
    return;
  }
  static NfcReq q;
  head(q, K_NFC_REQ, 0);
  q.id = wireId++;
  q.op = c.op;
  Station &s = stations.at[si];
  q.bound = s.tapSeen;  // bind it to the chip of the last tap passed on: the station refuses it for another
  q.tap = s.tapId;
  q.len = c.len;
  memcpy(q.data, c.data, c.len);
  s.nfcWire = q.id;
  s.nfcCaller = c.id;
  if (!start(si, q, sizeOf(q), POLICY_NFC, c.id, true)) emit(evFail(json, "nfc_fail", c.st, c.id, "busy"));
}

static void stats(const Command &c, const char *line) {
  if (!c.st[0]) {
    emit(evStatsC3(json, uxTaskGetStackHighWaterMark(nullptr), press::stackLeft(), serial::dropped() + inboxDrops(),
                   radio::sendFails(), millis()));
    return;
  }
  int si = stations.linkedNamed(c.st, millis());
  StatsReq q;
  head(q, K_STATS_REQ, 0);
  q.id = wireId++;
  if (si < 0) emit(evBad(json, "no such station linked", line));
  else if (!start(si, q, sizeof q, POLICY_SCREEN, 0, true)) emit(evBad(json, "busy", line));
}

void onCommand(const Command &c, const char *line) {
  if (c.result == Command::BAD_LINE) {
    emit(evBad(json, c.why, line));
    return;
  }
  if (c.result == Command::BAD_REQUEST) {
    const char *ev = c.type == C_BUZZ ? "buzz_fail" : c.type == C_SCREEN ? "screen_fail" : "nfc_fail";
    emit(evFail(json, ev, c.st, c.id, c.why));
    return;
  }
  switch (c.type) {
    case C_STATE:
      emit(evState(json, stations, millis()));
      break;
    case C_PRESS:
      press::trigger(c.id);
      break;
    case C_BUZZ:
      toStations(c, "buzz_fail", line);
      break;
    case C_SCREEN:
      toStations(c, "screen_fail", line);
      break;
    case C_NFC:
      nfc(c);
      break;
    case C_STATS:
      stats(c, line);
      break;
  }
}

void pollSlots(uint32_t nowMs) {
  for (auto &slot : slots.slots) {
    Slot::Due due = slot.poll(nowMs);
    if (due == Slot::SEND) {
      radio::send(slot.to, slot.buf, slot.len);
    } else if (due == Slot::EXPIRED) {
      const char *name = stations.at[slot.station].name;
      if (slot.kind == K_BUZZ) emit(evFail(json, "buzz_fail", name, slot.ref, "no ack"));
      else if (slot.kind == K_SCREEN) emit(evFail(json, "screen_fail", name, slot.ref, "no ack"));
      else if (slot.kind == K_NFC_REQ) emit(evFail(json, "nfc_fail", name, slot.ref, "no reply"));
      else {
        char line[13] = "stats ";  // the command that asked
        memcpy(line + 6, name, 7);
        emit(evBad(json, "no reply", line));
      }
    }
  }
}

}  // namespace rcv
