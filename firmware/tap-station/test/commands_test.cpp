// The Pi's commands: every example in protocol.md parses, and bad ones say why.
#include "check.h"
#include "commands.h"

using namespace rcv;

static Command c;

TEST(protocol_examples_parse) {
  CHECK_EQ(parse("state", c).result, Command::OK);
  CHECK_EQ(c.type, C_STATE);
  CHECK_EQ(parse("press 7", c).type, C_PRESS);
  CHECK_EQ(c.id, 7u);
  parse("buzz e4ba70 3 80", c);
  CHECK_EQ(c.result, Command::OK);
  CHECK_STR(c.st, "e4ba70");
  CHECK_EQ(c.ms, 80);
  CHECK_EQ(c.pulses, 1);
  parse("buzz df3d88 4 60 2", c);
  CHECK_EQ(c.ms, 60);
  CHECK_EQ(c.pulses, 2);
  parse("buzz all 9", c);
  CHECK_STR(c.st, "all");
  CHECK_EQ(c.ms, egb::BUZZ_MS_DEFAULT);
  parse("screen e4ba70 6 7461673d50310a6269673d5441500a736d616c6c3d4e4f5641", c);
  CHECK_EQ(c.result, Command::OK);
  CHECK_EQ(c.len, 25);
  CHECK_STR(std::string((char *)c.data, c.len), "tag=P1\nbig=TAP\nsmall=NOVA");
  parse("nfc e4ba70 12 apdu 00A4040007481199130E9F0100", c);
  CHECK_EQ(c.op, egb::OP_APDU);
  CHECK_EQ(c.len, 13);
  CHECK_EQ(parse("nfc e4ba70 13 reselect", c).op, egb::OP_RESELECT);
  CHECK_EQ(parse("nfc df3d88 14 list", c).op, egb::OP_LIST);
  CHECK_EQ(parse("nfc e4ba70 15 sign B051000002080000", c).op, egb::OP_SIGN);
  CHECK_EQ(parse("nfc e4ba70 16 select 04A1B2C3D4E5F6", c).len, 7);
  CHECK_EQ(parse("stats", c).type, C_STATS);
  CHECK_STR(c.st, "");
  parse("stats E4BA70", c);
  CHECK_STR(c.st, "e4ba70");  // hex either case in, the name lower case
}

TEST(bad_lines_say_why) {
  CHECK_EQ(parse("bogus 1", c).result, Command::BAD_LINE);
  CHECK_STR(c.why, "unknown command");
  CHECK_EQ(parse("press", c).result, Command::BAD_LINE);
  CHECK_EQ(parse("press 0", c).result, Command::BAD_LINE);  // ids are 1 to 2^32-1
  CHECK_EQ(parse("press 4294967296", c).result, Command::BAD_LINE);
  CHECK_EQ(parse("press 4294967295", c).result, Command::OK);
  CHECK_EQ(parse("buzz e4ba7 3", c).result, Command::BAD_LINE);
  CHECK_EQ(parse("nfc all 3 list", c).result, Command::BAD_LINE);  // nfc is one station
  CHECK_EQ(parse("state now", c).result, Command::BAD_LINE);
}

TEST(bad_requests_keep_station_and_id) {
  CHECK_EQ(parse("buzz e4ba70 3 2001", c).result, Command::BAD_REQUEST);
  CHECK_EQ(c.id, 3u);
  CHECK_STR(c.st, "e4ba70");
  CHECK_EQ(parse("buzz e4ba70 3 80 4", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("screen e4ba70 6 abc", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("screen e4ba70 6", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("nfc e4ba70 12 apdu", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("nfc e4ba70 12 dance", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("nfc e4ba70 12 select 00112233445566778899AA", c).result, Command::BAD_REQUEST);
  CHECK_EQ(parse("nfc e4ba70 12 list extra", c).result, Command::BAD_REQUEST);
  std::string apdu(2 * egb::APDU_MAX, 'A');
  CHECK_EQ(parse(("nfc e4ba70 12 apdu " + apdu).c_str(), c).result, Command::OK);
  CHECK_EQ(parse(("nfc e4ba70 12 apdu " + apdu + "00").c_str(), c).result, Command::BAD_REQUEST);
  std::string screen(2 * egb::SCREEN_MAX + 2, '4');
  CHECK_EQ(parse(("screen all 1 " + screen).c_str(), c).result, Command::BAD_REQUEST);
}
