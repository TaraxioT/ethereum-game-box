// The JSON writer, hex, and the line reader with its echo recovery.
#include "check.h"
#include "egb/hex.h"
#include "egb/json.h"
#include "egb/lines.h"

using namespace egb;

static std::string line(Json &j, size_t n) { return std::string(j.text(), n); }

TEST(json_writes_one_line) {
  char buf[256];
  Json j(buf, sizeof buf);
  uint8_t b[] = {0x04, 0xA1, 0xff};
  size_t n = j.begin("x").str("s", "a\"b\\c\n").u32("u", 4294967295u).i32("i", -41).i32("z", 0).boolean("t", true)
                 .null("n").hex("h", b, 3).arr("a").obj().u32("k", 1).close('}').obj().close('}').close(']')
                 .obj("o").close('}').end();
  CHECK_STR(line(j, n),
            "{\"ev\":\"x\",\"s\":\"a\\\"b\\\\c\\u000a\",\"u\":4294967295,\"i\":-41,\"z\":0,\"t\":true,\"n\":null,"
            "\"h\":\"04A1FF\",\"a\":[{\"k\":1},{}],\"o\":{}}\n");
  n = j.begin("y").i32("m", -2147483647 - 1).end();
  CHECK_STR(line(j, n), "{\"ev\":\"y\",\"m\":-2147483648}\n");
}

TEST(json_drops_a_line_that_overflows) {
  char buf[16];
  Json j(buf, sizeof buf);
  CHECK_EQ(j.begin("long").str("k", "too long for it").end(), 0u);
  CHECK(j.begin("ok").end() > 0);  // the next line starts afresh
}

TEST(hex_both_ways) {
  uint8_t b[4];
  CHECK_EQ(hexIn("0aFf", 4, b, sizeof b), 2);
  CHECK_EQ(b[0], 0x0a);
  CHECK_EQ(b[1], 0xff);
  CHECK_EQ(hexIn("abc", 3, b, sizeof b), -1);
  CHECK_EQ(hexIn("zz", 2, b, sizeof b), -1);
  CHECK_EQ(hexIn("0011223344", 10, b, sizeof b), -1);  // doesn't fit
  char out[8];
  CHECK_EQ(hexOut(out, b, 2), 4u);
  CHECK_STR(std::string(out, 4), "0AFF");
}

static const char *const WORDS[] = {"state", "press", "buzz", "screen", "nfc", "stats"};

static std::string feed(LineReader<64> &r, const char *s) {
  std::string got;
  for (; *s; s++) {
    if (!r.feed(*s)) continue;
    const char *cmd = unglue(r.line(), WORDS, 6);
    got += cmd ? std::string("[") + cmd + "]" : "(echo)";
  }
  return got;
}

TEST(lines_split_on_newline_and_drop_cr) {
  LineReader<64> r;
  CHECK_STR(feed(r, "state\r\npress 7\n"), "[state][press 7]");
}

TEST(lines_too_long_are_marked) {
  LineReader<8> r;
  const char *s = "0123456789\nok\n";
  bool over = false;
  for (; *s; s++)
    if (r.feed(*s)) over = over || r.line().tooLong;
  CHECK(over);
  CHECK_STR(r.line().text, "ok");
}

// A fresh tty echoes the board's own output back before the host switches it to raw (see egb/lines.h).
TEST(echoed_output_is_dropped_and_a_glued_command_recovered) {
  LineReader<64> r;
  CHECK_STR(feed(r, "{\"ev\":\"ready\",\"mac\":\"7CDFA1D504CC\",\"fw\":\"1.0.0\"}\n"), "(echo)");
  CHECK_STR(feed(r, "{\"ev\":\"ping\",\"st\":\"e4b" "state\n"), "[state]");
  CHECK_STR(feed(r, "rtt_us\":2760,\"rssi\":-3" "buzz e4ba70 3 80\n"), "[buzz e4ba70 3 80]");
  CHECK_STR(feed(r, "\"c3_led\":1}" "nfc e4ba70 12 list\n"), "[nfc e4ba70 12 list]");
  CHECK_STR(feed(r, "rst:0x1 (POWERON" "stats\n"), "[stats]");
  CHECK_STR(feed(r, "ESP-ROM:esp32c3-api1-20210207\n"), "(echo)");
  CHECK_STR(feed(r, "state\n"), "[state]");  // and the next line is clean again
}
