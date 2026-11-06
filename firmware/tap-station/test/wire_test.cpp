// Packets: sizes, building, and reading only whole packets of our own.
#include "check.h"
#include "egb/wire.h"

using namespace egb;

TEST(packets_are_small_and_fit_esp_now) {
  CHECK_EQ(sizeof(Head), 4u);
  CHECK_EQ(sizeof(Chip), 39u);
  CHECK(sizeof(Ping) <= 16);
  CHECK(sizeof(Press) <= 16);
  CHECK(sizeof(Buzz) <= 16);
  CHECK(sizeof(Got) <= 16);
  CHECK(sizeof(Tap) < 64);  // only tap, gone and signed carry the chip
  CHECK(sizeof(Gone) < 64);
  CHECK(sizeof(Signed) < 72);
  CHECK(PACKET_MAX <= 1470);  // ESP-NOW v2
  CHECK(sizeof(NfcRes) >= NFC_RES_HEAD + 6 * sizeof(Chip));  // a list reply holds six chips
}

TEST(a_packet_reads_back) {
  Tap t;
  head(t, K_TAP, F_NFC);
  t.id = 5;
  t.readUs = 27400;
  t.chip.uidLen = 7;
  t.chip.sak = 0x20;
  uint8_t buf[sizeof t];
  memcpy(buf, &t, sizeof t);
  CHECK_EQ(kindOf(buf, sizeof buf), (uint8_t)K_TAP);
  Tap back;
  CHECK(read(back, buf, sizeof buf));
  CHECK_EQ(back.id, 5u);
  CHECK(back.chip.isoDep());
  CHECK(!read(back, buf, sizeof buf - 1));  // fixed kinds must be whole
}

TEST(foreign_packets_are_ignored) {
  uint8_t junk[] = {0x47, K_TAP, 0, 0, 1, 2, 3};
  CHECK_EQ(kindOf(junk, sizeof junk), 0);
  uint8_t badKind[] = {MAGIC, K_COUNT, 0, 0};
  CHECK_EQ(kindOf(badKind, sizeof badKind), 0);
  CHECK_EQ(kindOf(badKind, 3), 0);
}

TEST(variable_packets_match_their_length) {
  NfcReq q;
  head(q, K_NFC_REQ, 0);
  q.id = 12;
  q.op = OP_APDU;
  q.len = 13;
  uint8_t buf[sizeof q];
  memcpy(buf, &q, sizeOf(q));
  NfcReq back;
  CHECK(read(back, buf, sizeOf(q)));
  CHECK_EQ(back.len, 13);
  CHECK(!read(back, buf, sizeOf(q) + 1));  // longer than its length field says
  CHECK(!read(back, buf, sizeOf(q) - 1));
  q.len = APDU_MAX + 1;
  memcpy(buf, &q, NFC_REQ_HEAD);
  CHECK(!read(back, buf, NFC_REQ_HEAD));
  Screen s;
  head(s, K_SCREEN, 0);
  s.len = SCREEN_MAX;
  memcpy(buf, &s, sizeOf(s));
  Screen sb;
  CHECK(read(sb, buf, sizeOf(s)));
}

TEST(chips_clamp_their_lengths) {
  Chip c = {};
  c.uidLen = 200;
  c.atsLen = 99;
  c.clamp();
  CHECK_EQ(c.uidLen, CHIP_UID_MAX);
  CHECK_EQ(c.atsLen, CHIP_ATS_MAX);
  Chip a = {}, b = {};
  a.uidLen = b.uidLen = 4;
  a.uid[0] = 1;
  CHECK(!a.sameAs(b));
  b.uid[0] = 1;
  CHECK(a.sameAs(b));
}
