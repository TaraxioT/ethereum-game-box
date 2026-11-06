// The receiver's view of its stations: every packet from one becomes the Pi's lines (link, button, nfc, then the
// packet's own event), and its acks close the requests waiting in the slots.
#include <atomic>

#include "events.h"
#include "loop.h"
#include "rx.h"

namespace rcv {

using namespace egb;

static std::atomic<uint64_t> pressTo{0xFFFFFFFFFFFFull};

void pressPeer(uint8_t mac[6]) { radio::macBytes(pressTo.load(), mac); }
void setPressPeer(const uint8_t mac[6]) { pressTo = radio::macBits(mac); }

static void refreshPressPeer(uint32_t nowMs) {
  int first = stations.firstLinked(nowMs);
  setPressPeer(first >= 0 ? stations.at[first].mac : radio::BROADCAST);
}

// The Pi hears that a station is up before any event from it, so it never sees a tap from a station it thinks gone.
static void sayUp(Station &s, uint32_t nowMs) {
  if (s.up) return;
  s.up = true;
  emit(evLink(json, s.name, true));
  refreshPressPeer(nowMs);
}

void checkLinks(uint32_t nowMs) {
  for (int i = 0; i < MAX_STATIONS; i++) {
    Station &s = stations.at[i];
    if (!s.up || stations.linked(i, nowMs)) continue;
    s.up = false;
    emit(evLink(json, s.name, false));
    refreshPressPeer(nowMs);
  }
}

// Every packet carries the station's button and reader state, so a lost packet that changed them heals.
static void sayFlags(Station &s, uint8_t flags) {
  uint8_t changed = (uint8_t)(flags ^ s.flags);
  s.flags = flags;
  if (changed & F_BTN) emit(evButton(json, "s3", s.name, flags & F_BTN));
  if (changed & F_NFC) emit(evNfc(json, s.name, flags & F_NFC));
}

static void onGot(Station &s, int si, const Msg &m) {
  Got g;
  if (!read(g, m.data, m.len)) return;
  Slot *slot = slots.take((uint8_t)si, g.of, g.id);
  if (!slot) return;  // a late copy, or a screen a newer one replaced
  const char *ev = g.of == K_BUZZ ? "buzz_ok" : g.of == K_SCREEN ? "screen_ok" : nullptr;
  if (ev) emit(evOk(json, ev, s.name, slot->ref, slot->sends, m.atUs - slot->startUs));
}

void onPacket(const Msg &m) {
  int si = stations.findOrAdd(m.mac);
  if (si < 0) return;  // a fifth station: ignored
  Station &s = stations.at[si];
  s.heardMs = m.atMs;
  s.rssi = m.rssi;
  sayUp(s, m.atMs);
  sayFlags(s, m.data[2]);
  switch (m.data[1]) {
    case K_PING: {
      Ping p;
      if (read(p, m.data, m.len))
        emit(evPing(json, s.name, p.rttUs, m.rssi, p.h.flags & F_NFC, p.h.flags & F_LED, led()));
      break;
    }
    case K_PRESS: {
      Press p;
      if (m.fresh && read(p, m.data, m.len)) emit(evS3Press(json, s.name, p.id, p.h.tries, led(), m.atUs));
      break;
    }
    case K_REPORT: {
      Report r;
      if (read(r, m.data, m.len) && r.id != s.reportId) {
        s.reportId = r.id;
        emit(evS3Report(json, s.name, r));
      }
      break;
    }
    case K_TAP: {
      Tap p;
      if (!read(p, m.data, m.len) || p.id == s.tapId) break;  // each id once: resends were acked by the callback
      s.tapId = p.id;
      p.chip.clamp();
      s.chip = p.chip;
      s.chipOn = true;
      emit(evTap(json, s.name, p, m.atUs));
      break;
    }
    case K_GONE: {
      Gone p;
      if (!read(p, m.data, m.len) || p.id == s.goneId) break;
      s.goneId = p.id;
      p.chip.clamp();
      if (s.chipOn && s.chip.sameAs(p.chip)) s.chipOn = false;
      emit(evGone(json, s.name, p, m.atUs));
      break;
    }
    case K_SIGNED: {
      Signed p;
      if (!read(p, m.data, m.len) || p.id == s.signedId) break;
      s.signedId = p.id;
      p.chip.clamp();
      // Named by the caller's id for the sign request, which the reply may already have taken out of its slot.
      emit(evSigned(json, s.name, p.id == s.nfcWire ? s.nfcCaller : p.id, p, m.atUs));
      break;
    }
    case K_GOT:
      onGot(s, si, m);
      break;
    case K_NFC_RES: {
      static NfcRes r;  // too big for the loop's stack; only the loop task uses it
      if (!read(r, m.data, m.len)) break;
      Slot *slot = slots.take((uint8_t)si, K_NFC_REQ, r.id);
      if (slot) emit(evNfcRes(json, s.name, slot->ref, r, m.atUs - slot->startUs, slot->sends));
      break;
    }
    case K_STATS_RES: {
      StatsRes r;
      if (read(r, m.data, m.len) && slots.take((uint8_t)si, K_STATS_REQ, r.id)) emit(evStatsS3(json, s.name, r));
      break;
    }
    default:  // a release (its button state was taken above), or an ack for our press (the press task has it)
      break;
  }
}

void onPress(const press::Outcome &o) {
  if (o.what == press::Outcome::STARTED) {
    emit(evC3Press(json, o.ref, o.atUs));
  } else if (o.what == press::Outcome::ACKED) {
    int si = stations.findOrAdd(o.peer);  // the ack itself may still be on its way through the inbox
    emit(evC3Ack(json, si >= 0 ? stations.at[si].name : "", o.ref, o.rttUs, o.sends, o.peerFlags & F_LED));
  } else {
    emit(evC3Fail(json, o.ref, o.sends));
  }
}

}  // namespace rcv
