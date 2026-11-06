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
  s.detectedMs = s.activeMs = detectedMs;
  s.taps = 1;
  return s;
}

TEST(hold_while_the_app_reads_then_done_then_the_pis_screen) {
  Snapshot s = held(PH_DETECTED, 1000);
  Shown v = shown(s, 1000, false);
  CHECK_EQ(v.look, LOOK_HOLD);
  CHECK_EQ(v.led, BLUE);
  CHECK_EQ(shown(s, 1200, false).led, 0u);  // blinking, 200 ms
  CHECK_EQ(shown(s, 1375, false).sweep, 3u);
  CHECK_EQ(shown(s, 1600, true).look, LOOK_IDLE);  // nobody read it: the Pi's screen, the badge still resting
  CHECK_EQ(shown(s, 1600, true).led, WHITE);
  s.phase = PH_READING;  // the station's select, or the Pi's read, ended well at 1050
  s.activeMs = s.goodMs = 1050;
  CHECK_EQ(shown(s, 1300, false).look, LOOK_HOLD);  // the app may have more to ask
  v = shown(s, 1550, false);
  CHECK_EQ(v.look, LOOK_DONE);
  CHECK_EQ(v.led, GREEN);
  CHECK_EQ(shown(s, 3049, false).look, LOOK_DONE);
  v = shown(s, 3050, true);  // 1.5 s of DONE, then the Pi's screen though the chip stays on the reader
  CHECK_EQ(v.look, LOOK_IDLE);
  CHECK_EQ(v.led, WHITE);
  s.activeMs = 4000;  // the Pi reads again: HOLD again
  CHECK_EQ(shown(s, 4100, false).look, LOOK_HOLD);
}

TEST(a_newer_screen_ends_the_result_at_once) {
  Snapshot s = held(PH_READING, 1000);
  s.activeMs = s.goodMs = 1050;
  s.screenSet = true;
  s.screenMs = 1100;  // sent while the chip was being read: the result still shows
  CHECK_EQ(shown(s, 1800, false).look, LOOK_DONE);
  s.screenMs = 1700;  // a different screen after DONE began
  CHECK_EQ(shown(s, 1800, false).look, LOOK_IDLE);
  CHECK_EQ(shown(s, 1800, false).led, 0u);
}

TEST(signing_and_its_results) {
  Snapshot s = held(PH_SIGNING, 1000);
  CHECK_EQ(shown(s, 1000, false).look, LOOK_SIGN);
  CHECK_EQ(shown(s, 1080, false).led, 0u);  // the fast blink, 80 ms
  s.phase = PH_SIGNED;
  s.signedMs = 2000;
  CHECK_EQ(shown(s, 2100, false).look, LOOK_DONE);
  CHECK_EQ(shown(s, 2100, false).led, GREEN);
  CHECK_EQ(shown(s, 3500, false).look, LOOK_IDLE);
  s.phase = PH_FAILED;
  s.failedMs = 2000;
  CHECK_EQ(shown(s, 2100, false).look, LOOK_SIGN);  // the Pi retries at once: still HOLD STILL
  CHECK_EQ(shown(s, 2600, false).look, LOOK_FAIL);  // then AGAIN, red for a second
  CHECK_EQ(shown(s, 2600, false).led, RED);
  CHECK_EQ(shown(s, 3700, false).look, LOOK_FAIL);
  CHECK_EQ(shown(s, 3700, false).led, 0u);
  CHECK_EQ(shown(s, 4100, false).look, LOOK_IDLE);
  s.chipOn = false;  // lifted mid-sign
  s.phase = PH_SIGNING;
  s.tooSoon = true;
  s.liftedMs = 3000;
  Shown v = shown(s, 3100, true);
  CHECK_EQ(v.look, LOOK_FAIL);
  CHECK(v.soon);
  CHECK_EQ(v.led, RED);
  CHECK_EQ(shown(s, 4100, true).led, WHITE);  // red for a second, then the receiver's white
  CHECK_EQ(shown(s, 4500, true).look, LOOK_IDLE);
  s.nfcOk = false;
  CHECK_EQ(shown(s, 4500, true).look, LOOK_FAULT);
}

TEST(lifted_after_a_good_read_is_done_at_once) {
  Snapshot s = held(PH_READING, 1000);
  s.activeMs = s.goodMs = 1050;
  s.chipOn = false;
  s.liftedMs = 1200;
  CHECK_EQ(shown(s, 1300, false).look, LOOK_DONE);
  CHECK_EQ(shown(s, 2700, false).look, LOOK_IDLE);
}

TEST(the_picture_wakes_the_oled_when_it_moves) {
  Snapshot s = held(PH_DETECTED, 1000);
  CHECK_EQ(nextChangeMs(s, 1000), 80);
  CHECK_EQ(nextChangeMs(s, 1190), 10);  // the 200 ms blink
  s.phase = PH_READING;
  s.activeMs = s.goodMs = 1050;
  CHECK_EQ(nextChangeMs(s, 1540), 10);  // DONE begins at 1550, before the next blink or sweep step
  CHECK_EQ(nextChangeMs(s, 3000), 50);  // DONE ends
  s.chipOn = false;
  s.phase = PH_SIGNING;
  s.tooSoon = true;
  s.liftedMs = 5000;
  CHECK_EQ(nextChangeMs(s, 5000), (int32_t)RED_MS);
  CHECK_EQ(nextChangeMs(s, 6200), 300);
  CHECK_EQ(nextChangeMs(s, 7000), -1);
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
