// The receiver's lines to the Pi (protocol.md, "Events"), one function per event, each into the one JSON writer.
// Plain C++: the host tests check them against protocol.md's example lines, byte for byte.
#pragma once

#include "egb/json.h"
#include "egb/stations.h"
#include "egb/wire.h"

namespace rcv {

using egb::Json;

inline const char *opName(uint8_t op) {
  static const char *const OPS[egb::OP_COUNT] = {"?", "apdu", "sign", "reselect", "select", "list"};
  return op < egb::OP_COUNT ? OPS[op] : "?";
}

inline size_t evReady(Json &j, const uint8_t mac[6], const char *fw) {
  return j.begin("ready").hex("mac", mac, 6).str("fw", fw).end();
}

inline size_t evState(Json &j, const egb::Stations &t, uint32_t nowMs) {
  j.begin("state").arr("stations");
  for (int i = 0; i < egb::MAX_STATIONS; i++) {
    const egb::Station &s = t.at[i];
    if (!s.used) continue;
    j.obj().str("st", s.name).boolean("up", t.linked(i, nowMs)).boolean("nfc", s.flags & egb::F_NFC);
    if (s.chipOn) j.hex("uid", s.chip.uid, s.chip.uidLen);
    else j.null("uid");
    j.i32("rssi", s.rssi).close('}');
  }
  return j.close(']').end();
}

inline size_t evLink(Json &j, const char *st, bool up) { return j.begin("link").str("st", st).boolean("up", up).end(); }

inline size_t evPing(Json &j, const char *st, uint32_t rttUs, int8_t rssi, bool nfc, bool s3Led, bool c3Led) {
  return j.begin("ping").str("st", st).u32("rtt_us", rttUs).i32("rssi", rssi).boolean("nfc", nfc)
      .u32("s3_led", s3Led).u32("c3_led", c3Led).end();
}

inline size_t evNfc(Json &j, const char *st, bool ok) { return j.begin("nfc").str("st", st).boolean("ok", ok).end(); }

inline size_t evBad(Json &j, const char *why, const char *line) {
  return j.begin("bad").str("why", why).str("line", line).end();
}

inline Json &chipFields(Json &j, const egb::Chip &c) {
  return j.hex("uid", c.uid, c.uidLen).hex("atqa", c.atqa, 2).hex("sak", &c.sak, 1).hex("ats", c.ats, c.atsLen);
}

inline size_t evTap(Json &j, const char *st, const egb::Tap &p, uint32_t atUs) {
  j.begin("tap").str("st", st).u32("id", p.id);
  return chipFields(j, p.chip).u32("read_us", p.readUs).u32("gap_us", p.gapUs).u32("tries", p.h.tries)
      .u32("at_us", atUs).end();
}

inline size_t evGone(Json &j, const char *st, const egb::Gone &p, uint32_t atUs) {
  return j.begin("gone").str("st", st).u32("id", p.id).hex("uid", p.chip.uid, p.chip.uidLen).u32("at_us", atUs).end();
}

inline size_t evSigned(Json &j, const char *st, uint32_t id, const egb::Signed &p, uint32_t atUs) {
  return j.begin("signed").str("st", st).u32("id", id).u32("tap", p.tap).hex("uid", p.chip.uid, p.chip.uidLen)
      .boolean("ok", p.ok).u32("chip_us", p.chipUs).u32("total_us", p.totalUs).u32("at_us", atUs).end();
}

// buzz_ok / screen_ok
inline size_t evOk(Json &j, const char *ev, const char *st, uint32_t id, uint8_t tries, uint32_t rttUs) {
  return j.begin(ev).str("st", st).u32("id", id).u32("tries", tries).u32("rtt_us", rttUs).end();
}

// `buzz` / `screen` with no linked station to send to: a fail naming the station, or for `buzz all` the one
// protocol.md gives; `screen all` has no fail line of its own there, so it gets `bad`.
inline size_t evNoStation(Json &j, const char *failEv, const char *st, uint32_t id, const char *line) {
  if (!strcmp(failEv, "screen_fail") && !strcmp(st, "all")) return j.begin("bad").str("why", "no such station linked")
      .str("line", line).end();
  return j.begin(failEv).str("st", st).u32("id", id).str("why", "no such station linked").end();
}

// buzz_fail / screen_fail / nfc_fail
inline size_t evFail(Json &j, const char *ev, const char *st, uint32_t id, const char *why) {
  return j.begin(ev).str("st", st).u32("id", id).str("why", why).end();
}

inline size_t evNfcRes(Json &j, const char *st, uint32_t id, const egb::NfcRes &r, uint32_t rttUs, uint8_t tries) {
  j.begin("nfc_res").str("st", st).u32("id", id).str("op", opName(r.op)).boolean("ok", !r.err).u32("err", r.err);
  if (r.err == egb::ERR_RF) j.u32("pn532", r.pn532);
  if (!r.err && (r.op == egb::OP_APDU || r.op == egb::OP_SIGN)) j.hex("hex", r.data, r.len);
  if (!r.err && (r.op == egb::OP_RESELECT || r.op == egb::OP_SELECT || r.op == egb::OP_LIST)) {
    j.arr("tags");
    for (size_t k = 0; (k + 1) * sizeof(egb::Chip) <= r.len; k++) {
      egb::Chip c;
      memcpy(&c, r.data + k * sizeof c, sizeof c);
      c.clamp();
      chipFields(j.obj(), c).close('}');
    }
    j.close(']');
  }
  if (r.sel) {
    uint8_t sw[2] = {(uint8_t)(r.sel >> 8), (uint8_t)r.sel};
    j.hex("sel", sw, 2);
  }
  return j.u32("us", r.us).u32("wait_us", r.waitUs).u32("rtt_us", rttUs).u32("tries", tries).end();
}

inline size_t evC3Press(Json &j, uint32_t id, uint32_t atUs) { return j.begin("c3_press").u32("id", id).u32("at_us", atUs).end(); }

inline size_t evC3Ack(Json &j, const char *st, uint32_t id, uint32_t rttUs, uint8_t tries, bool s3Led) {
  return j.begin("c3_ack").str("st", st).u32("id", id).u32("rtt_us", rttUs).u32("tries", tries).u32("s3_led", s3Led)
      .end();
}

inline size_t evC3Fail(Json &j, uint32_t id, uint8_t tries) { return j.begin("c3_fail").u32("id", id).u32("tries", tries).end(); }

inline size_t evS3Press(Json &j, const char *st, uint32_t id, uint8_t tries, bool c3Led, uint32_t atUs) {
  return j.begin("s3_press").str("st", st).u32("id", id).u32("tries", tries).u32("c3_led", c3Led).u32("at_us", atUs)
      .end();
}

inline size_t evS3Report(Json &j, const char *st, const egb::Report &r) {
  return j.begin("s3_report").str("st", st).u32("id", r.id).u32("rtt_us", r.rttUs).u32("tries", r.sends).end();
}

// st: nullptr for the receiver's own button.
inline size_t evButton(Json &j, const char *board, const char *st, bool down) {
  j.begin("button").str("board", board);
  if (st) j.str("st", st);
  return j.boolean("down", down).end();
}

inline size_t evStatsC3(Json &j, uint32_t loopStack, uint32_t pressStack, uint32_t dropped, uint32_t sendFails,
                        uint32_t upMs) {
  return j.begin("stats").str("board", "c3").obj("stack").u32("loop", loopStack).u32("press", pressStack).close('}')
      .u32("dropped", dropped).u32("send_fails", sendFails).u32("up_ms", upMs).end();
}

inline size_t evStatsS3(Json &j, const char *st, const egb::StatsRes &r) {
  return j.begin("stats").str("board", "s3").str("st", st).obj("stack").u32("loop", r.stack[egb::T_LOOP])
      .u32("nfc", r.stack[egb::T_NFC]).u32("oled", r.stack[egb::T_OLED]).u32("press", r.stack[egb::T_PRESS])
      .close('}').u32("dropped", r.dropped).u32("send_fails", r.sendFails).u32("up_ms", r.upMs).end();
}

}  // namespace rcv
