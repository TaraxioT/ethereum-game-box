// PN532 frames: what goes out, and reading what comes back.
#include "check.h"
#include "pn532_frame.h"

using namespace st;

TEST(a_command_frame) {
  uint8_t out[16], cmd[] = {0x02};  // GetFirmwareVersion
  size_t n = frame::build(cmd, 1, out);
  uint8_t want[] = {0x00, 0x00, 0xFF, 0x02, 0xFE, 0xD4, 0x02, 0x2A, 0x00};
  CHECK_EQ(n, sizeof want);
  CHECK(!memcmp(out, want, n));
}

TEST(an_ack_and_an_answer) {
  uint8_t ack[] = {0x01, 0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};
  CHECK(frame::isAck(ack, sizeof ack));
  ack[4] = 0x01;
  CHECK(!frame::isAck(ack, sizeof ack));
  // ready, then the firmware answer: IC 0x32, ver 1, rev 6, support 7
  uint8_t ans[] = {0x01, 0x00, 0x00, 0xFF, 0x06, 0xFA, 0xD5, 0x03, 0x32, 0x01, 0x06, 0x07, 0xE8, 0x00};
  CHECK_EQ(frame::fullLength(ans, 8), sizeof ans);  // known from the first bytes: read 16, NACK for more
  uint8_t data[8];
  CHECK_EQ(frame::parse(ans, sizeof ans, 0x02, data, sizeof data), 4);
  CHECK_EQ(data[0], 0x32);
  CHECK_EQ(frame::parse(ans, sizeof ans, 0x4A, data, sizeof data), -1);  // not that command's answer
  CHECK_EQ(frame::parse(ans, sizeof ans - 2, 0x02, data, sizeof data), -1);  // cut short
  ans[9] ^= 1;
  CHECK_EQ(frame::parse(ans, sizeof ans, 0x02, data, sizeof data), -1);  // bad checksum
}

TEST(listed_chips) {
  // NbTg 1: Tg 1, ATQA 0044, SAK 20, 7-byte UID, ATS (5 bytes with its length byte)
  uint8_t r[] = {0x01, 0x01, 0x00, 0x44, 0x20, 0x07, 0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6,
                 0x05, 0x78, 0x80, 0x70, 0x02};
  egb::Chip c[2];
  CHECK_EQ(frame::targets(r, sizeof r, c, 2), 1);
  CHECK_EQ(c[0].uidLen, 7);
  CHECK_EQ(c[0].uid[6], 0xF6);
  CHECK_EQ(c[0].atsLen, 4);
  CHECK_EQ(c[0].ats[0], 0x78);
  CHECK(c[0].isoDep());
  uint8_t none[] = {0x00};
  CHECK_EQ(frame::targets(none, 1, c, 2), 0);
  CHECK_EQ(frame::targets(r, 9, c, 2), 0);  // cut inside the UID
}

TEST(a_255_byte_apdu_goes_as_an_extended_frame) {
  uint8_t cmd[2 + egb::APDU_MAX], out[frame::MAX_FRAME];
  cmd[0] = 0x40;
  cmd[1] = 0x01;
  memset(cmd + 2, 0xAB, egb::APDU_MAX);
  size_t n = frame::build(cmd, sizeof cmd, out);
  CHECK_EQ(n, sizeof cmd + 11);
  CHECK_EQ(out[3], 0xFF);
  CHECK_EQ(out[4], 0xFF);
  CHECK_EQ((out[5] << 8 | out[6]), (int)sizeof cmd + 1);  // TFI and data
  CHECK_EQ((uint8_t)(out[5] + out[6] + out[7]), 0);
  CHECK_EQ(out[8], frame::HOST_TO_PN532);
  uint8_t sum = 0;
  for (size_t i = 8; i < n - 1; i++) sum = (uint8_t)(sum + out[i]);
  CHECK_EQ(sum, 0);
  CHECK_EQ(frame::build(cmd, frame::MAX_DATA + 1, out), 0u);
}

TEST(a_long_answer_comes_back_as_an_extended_frame) {
  // ready, 00 00 FF FF FF LEN(0x0103) LCS, D5 41, status 00, 256 bytes of data, DCS, 00
  uint8_t b[1 + 8 + 0x103 + 2] = {0x01, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x01, 0x03};
  b[8] = (uint8_t)-(0x01 + 0x03);
  b[9] = 0xD5;
  b[10] = 0x41;
  b[11] = 0x00;
  uint8_t sum = (uint8_t)(0xD5 + 0x41);
  for (int i = 0; i < 256; i++) sum = (uint8_t)(sum + (b[12 + i] = (uint8_t)i));
  b[12 + 256] = (uint8_t)-sum;
  CHECK_EQ(frame::fullLength(b, 16), sizeof b);
  uint8_t data[300];
  CHECK_EQ(frame::parse(b, sizeof b, 0x40, data, sizeof data), 257);
  CHECK_EQ(data[0], 0x00);
  CHECK_EQ(data[256], 255);
}
