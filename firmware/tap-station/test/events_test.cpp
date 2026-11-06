// The receiver's lines: built from packets as the radio delivers them, each must appear verbatim in protocol.md.
#include <fstream>
#include <sstream>

#include "check.h"
#include "events.h"

using namespace egb;
using namespace rcv;

static std::string protocol() {
  static std::string text;
  if (text.empty()) {
    std::ifstream f(PROTOCOL_MD);
    std::stringstream ss;
    ss << f.rdbuf();
    text = ss.str();
  }
  return text;
}

static char buf[1024];
static Json j(buf, sizeof buf);

#define CHECK_IN_PROTOCOL(n)                                                                    \
  do {                                                                                          \
    std::string l(j.text(), (n));                                                               \
    CHECK(!l.empty() && l.back() == '\n');                                                      \
    l.pop_back();                                                                               \
    check::checks()++;                                                                          \
    if (protocol().find("\n" + l + "\n") == std::string::npos)                                 \
      check::fail(__FILE__, __LINE__, "not in protocol.md: " + l);                              \
  } while (0)

static Chip halo() {
  Chip c = {};
  uint8_t uid[] = {0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6}, ats[] = {0x78, 0x80, 0x70, 0x02};
  c.atqa[1] = 0x44;
  c.sak = 0x20;
  c.uidLen = 7;
  memcpy(c.uid, uid, 7);
  c.atsLen = 4;
  memcpy(c.ats, ats, 4);
  return c;
}

TEST(receiver_and_link_lines) {
  uint8_t mac[] = {0x7C, 0xDF, 0xA1, 0xD5, 0x04, 0xCC};
  CHECK_IN_PROTOCOL(evReady(j, mac, FW_VERSION));
  Stations t;
  uint8_t a[] = {0xDC, 0x54, 0x75, 0xE4, 0xBA, 0x70}, b[] = {0xDC, 0x54, 0x75, 0xDF, 0x3D, 0x88};
  int i = t.findOrAdd(a), k = t.findOrAdd(b);
  t.at[i].heardMs = 1000;
  t.at[i].flags = F_NFC;
  t.at[i].chipOn = true;
  t.at[i].chip = halo();
  t.at[i].rssi = -41;
  t.at[k].heardMs = 1000 - LINK_TIMEOUT_MS;
  CHECK_IN_PROTOCOL(evState(j, t, 1000));
  CHECK_IN_PROTOCOL(evLink(j, "e4ba70", true));
  CHECK_IN_PROTOCOL(evLink(j, "e4ba70", false));
  CHECK_IN_PROTOCOL(evPing(j, "e4ba70", 2760, -37, true, false, true));
  CHECK_IN_PROTOCOL(evNfc(j, "e4ba70", false));
  CHECK_IN_PROTOCOL(evBad(j, "unknown command", "bogus 1"));
}

TEST(chip_lines) {
  Tap p;
  head(p, K_TAP, 0);
  p.h.tries = 1;
  p.id = 5;
  p.readUs = 27400;
  p.gapUs = 20500;
  p.chip = halo();
  CHECK_IN_PROTOCOL(evTap(j, "e4ba70", p, 4012345678u));
  Gone g;
  head(g, K_GONE, 0);
  g.id = 5;
  g.chip = halo();
  CHECK_IN_PROTOCOL(evGone(j, "e4ba70", g, 4013345678u));
  Signed s;
  head(s, K_SIGNED, 0);
  s.tap = 5;
  s.ok = 1;
  s.chipUs = 402000;
  s.totalUs = 560000;
  s.chip = halo();
  CHECK_IN_PROTOCOL(evSigned(j, "e4ba70", 12, s, 4013000000u));
}

TEST(request_lines) {
  CHECK_IN_PROTOCOL(evOk(j, "buzz_ok", "e4ba70", 3, 1, 2900));
  CHECK_IN_PROTOCOL(evFail(j, "buzz_fail", "e4ba70", 3, "no ack"));
  CHECK_IN_PROTOCOL(evFail(j, "buzz_fail", "all", 4, "no such station linked"));
  CHECK_IN_PROTOCOL(evOk(j, "screen_ok", "e4ba70", 6, 1, 3100));
  CHECK_IN_PROTOCOL(evFail(j, "screen_fail", "e4ba70", 6, "no ack"));
  CHECK_IN_PROTOCOL(evFail(j, "screen_fail", "e4ba70", 7, "bad request"));
  static NfcRes r;
  head(r, K_NFC_RES, 0);
  r.op = OP_APDU;
  r.len = 2;
  r.data[0] = 0x90;
  r.us = 21500;
  r.waitUs = 12900;
  CHECK_IN_PROTOCOL(evNfcRes(j, "e4ba70", 12, r, 24800, 1));
  r.op = OP_RESELECT;
  Chip c = halo();
  memcpy(r.data, &c, sizeof c);
  r.len = sizeof c;
  r.sel = 0x9000;
  r.us = 52000;
  r.waitUs = 44000;
  CHECK_IN_PROTOCOL(evNfcRes(j, "e4ba70", 13, r, 56000, 2));
  r.op = OP_LIST;
  r.len = 0;
  r.sel = 0;
  r.us = 30500;
  r.waitUs = 24100;
  CHECK_IN_PROTOCOL(evNfcRes(j, "df3d88", 14, r, 34800, 1));
  r.op = OP_APDU;
  r.err = ERR_RF;
  r.pn532 = 1;
  r.us = 350000;
  r.waitUs = 349000;
  CHECK_IN_PROTOCOL(evNfcRes(j, "e4ba70", 15, r, 355000, 9));
  CHECK_IN_PROTOCOL(evFail(j, "nfc_fail", "e4ba70", 16, "no reply"));
  CHECK_IN_PROTOCOL(evFail(j, "nfc_fail", "0a0b0c", 17, "no such station linked"));
}

TEST(press_and_stats_lines) {
  CHECK_IN_PROTOCOL(evC3Press(j, 7, 4012345000u));
  CHECK_IN_PROTOCOL(evC3Ack(j, "e4ba70", 7, 2390, 1, true));
  CHECK_IN_PROTOCOL(evC3Fail(j, 7, 25));
  CHECK_IN_PROTOCOL(evS3Press(j, "e4ba70", 9, 1, true, 4012346000u));
  Report r;
  head(r, K_REPORT, 0);
  r.id = 9;
  r.rttUs = 2780;
  r.sends = 1;
  CHECK_IN_PROTOCOL(evS3Report(j, "e4ba70", r));
  CHECK_IN_PROTOCOL(evButton(j, "s3", "e4ba70", true));
  CHECK_IN_PROTOCOL(evButton(j, "c3", nullptr, false));
  CHECK_IN_PROTOCOL(evStatsC3(j, 2210, 1420, 0, 0, 360000));
  StatsRes s;
  head(s, K_STATS_RES, 0);
  s.stack[T_LOOP] = 3100;
  s.stack[T_NFC] = 2900;
  s.stack[T_OLED] = 1800;
  s.stack[T_PRESS] = 1500;
  s.upMs = 358000;
  CHECK_IN_PROTOCOL(evStatsS3(j, "e4ba70", s));
}

TEST(no_linked_station_lines) {
  CHECK_IN_PROTOCOL(evNoStation(j, "buzz_fail", "all", 4, "buzz all 4"));
  size_t n = evNoStation(j, "screen_fail", "all", 6, "screen all 6 6269673d4849");
  CHECK_STR(std::string(j.text(), n),
            "{\"ev\":\"bad\",\"why\":\"no such station linked\",\"line\":\"screen all 6 6269673d4849\"}\n");
  n = evNoStation(j, "screen_fail", "e4ba70", 7, "");
  CHECK_STR(std::string(j.text(), n), "{\"ev\":\"screen_fail\",\"st\":\"e4ba70\",\"id\":7,\"why\":\"no such station linked\"}\n");
}
