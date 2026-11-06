// The screen: the Pi's payload, the LED/OLED table, and the fonts (drawn with U8g2's C library).
#include "check.h"
#include "screen_draw.h"

using namespace st;

TEST(a_screen_payload) {
  ScreenSpec s;
  const char p[] = "tag=p1\nbig=tap\nsmall=Stake $1.00\ndone=PAID|$1.00 staked\nttl=15\nbogus=1\nno equals\r\n";
  screenParse(p, sizeof p - 1, s);
  CHECK_STR(s.tag, "P1");
  CHECK_STR(s.idle.big, "TAP");
  CHECK(s.idle.given);
  CHECK_STR(s.idle.small, "Stake $1.00");
  CHECK(s.feedback[FB_DONE].given);
  CHECK_STR(s.feedback[FB_DONE].big, "PAID");
  CHECK_STR(s.feedback[FB_DONE].small, "$1.00 staked");
  CHECK(!s.feedback[FB_HOLD].given);
  CHECK_EQ(s.ttlS, 15u);
}

TEST(screen_limits_and_odd_bytes) {
  ScreenSpec s;
  const char p[] = "tag=ABCD\nbig=abcdefghijklm\nhold=WAIT\nfail=\nttl=99999999999\nsmall=a\x01" "b";
  screenParse(p, sizeof p - 1, s);
  CHECK_STR(s.tag, "ABC");
  CHECK_STR(s.idle.big, "ABCDEFGHIJ");
  CHECK_STR(s.feedback[FB_HOLD].big, "WAIT");
  CHECK_STR(s.feedback[FB_HOLD].small, "");  // no bar: no small line
  CHECK(!s.feedback[FB_FAIL].given);           // empty: the default
  CHECK_EQ(s.ttlS, TTL_MAX_S);
  CHECK_STR(s.idle.small, "a?b");
  screenParse("big=", 4, s);
  CHECK(s.idle.given);
  CHECK_STR(s.idle.big, "");  // given and empty: no big line
}

static Snapshot held(uint8_t phase, uint32_t detectedMs) {
  Snapshot s = {};
  s.nfcOk = true;
  s.chipOn = true;
  s.phase = phase;
  s.detectedMs = detectedMs;
  s.taps = 1;
  return s;
}

TEST(the_led_and_oled_table) {
  Snapshot s = held(PH_DETECTED, 1000);
  Shown v = shown(s, 1000, false);
  CHECK_EQ(v.look, LOOK_HOLD);
  CHECK_EQ(v.led, BLUE);
  CHECK_EQ(shown(s, 1200, false).led, 0u);  // blinking, 200 ms
  CHECK_EQ(shown(s, 1375, false).sweep, 3u);
  s.phase = PH_SIGNING;
  CHECK_EQ(shown(s, 1000, false).look, LOOK_SIGN);
  CHECK_EQ(shown(s, 1080, false).led, 0u);  // the fast blink, 80 ms
  s.phase = PH_SIGNED;
  CHECK_EQ(shown(s, 1500, false).look, LOOK_DONE);
  CHECK_EQ(shown(s, 1500, false).led, GREEN);
  s.phase = PH_FAILED;
  s.failedMs = 2000;
  CHECK_EQ(shown(s, 2100, false).look, LOOK_SIGN);  // the Pi retries at once: still HOLD STILL
  CHECK_EQ(shown(s, 2600, false).look, LOOK_FAIL);  // then AGAIN, red
  CHECK_EQ(shown(s, 2600, false).led, RED);
  s.chipOn = false;
  s.phase = PH_SIGNING;
  s.tooSoon = true;
  s.liftedMs = 3000;
  v = shown(s, 3100, true);
  CHECK_EQ(v.look, LOOK_FAIL);
  CHECK(v.soon);
  CHECK_EQ(v.led, RED);
  CHECK_EQ(shown(s, 4100, true).led, WHITE);  // red for a second, then the receiver's white
  CHECK_EQ(shown(s, 4600, true).look, LOOK_IDLE);
  s.nfcOk = false;
  CHECK_EQ(shown(s, 4600, true).look, LOOK_FAULT);
}

TEST(the_picture_wakes_the_oled_when_it_moves) {
  Snapshot s = held(PH_DETECTED, 1000);
  CHECK_EQ(nextChangeMs(s, 1000), 80);
  CHECK_EQ(nextChangeMs(s, 1190), 10);  // the 200 ms blink
  s.chipOn = false;
  s.liftedMs = 2000;
  CHECK_EQ(nextChangeMs(s, 2000), (int32_t)RED_MS);
  CHECK_EQ(nextChangeMs(s, 3200), 300);
  CHECK_EQ(nextChangeMs(s, 4000), -1);
}

// U8g2 with no display behind it: the frame only goes into the buffer.
static uint8_t noBytes(u8x8_t *, uint8_t, uint8_t, void *) { return 1; }
static uint8_t noGpio(u8x8_t *, uint8_t, uint8_t, void *) { return 1; }

static u8g2_t *display() {
  static u8g2_t d;
  static bool set = false;
  if (!set) {
    u8g2_Setup_ssd1306_i2c_72x40_er_f(&d, U8G2_R0, noBytes, noGpio);
    u8g2_InitDisplay(&d);
    set = true;
  }
  return &d;
}

static int width(const char *s, int font) {
  u8g2_SetFont(display(), BIG_FONTS[font]);
  return u8g2_GetStrWidth(display(), s);
}

TEST(big_text_gets_the_largest_font_that_fits) {
  u8g2_t *d = display();
  int area = SCREEN_H - 1 - TOP + 1;  // no small line
  CHECK_EQ(fitBigFont(d, "TAP", SCREEN_W, area), 0);  // three letters: the 28 px font
  for (const char *s : {"HOLD", "HOLD STILL", "DONE", "AGAIN", "TOO SOON", "TAP", "WAIT", "SIGN", "WIN", "NO READER",
                        "REPLUG", "NO RADIO", "WWWWWWWWWW"}) {
    int f = fitBigFont(d, s, SCREEN_W, area);
    check::checks()++;
    if (f < BIG_FONT_COUNT - 1 && width(s, f) > SCREEN_W) check::fail(__FILE__, __LINE__, std::string("too wide: ") + s);
    if (strlen(s) <= BIG_MAX && width(s, BIG_FONT_COUNT - 1) > SCREEN_W)
      check::fail(__FILE__, __LINE__, std::string("ten characters must fit the last font: ") + s);
  }
  // Under a small line there's less height, so a smaller font.
  CHECK(fitBigFont(d, "TAP", SCREEN_W, area - 9) > 0);
}

TEST(every_look_draws) {
  u8g2_t *d = display();
  for (int look = LOOK_IDLE; look <= LOOK_FAULT; look++) {
    ScreenView v = {(Look)look, "HOLD STILL", "signing", "P1", true, true, 7};
    drawScreen(d, v);
    uint8_t *buf = u8g2_GetBufferPtr(d);
    int lit = 0;
    for (int i = 0; i < SCREEN_W * SCREEN_H / 8; i++) lit += __builtin_popcount(buf[i]);
    check::checks()++;
    if (lit == 0 || lit == SCREEN_W * SCREEN_H) check::fail(__FILE__, __LINE__, "blank frame for look " + std::to_string(look));
  }
}
