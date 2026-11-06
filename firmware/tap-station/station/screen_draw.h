// Draws one OLED frame (72x40) with U8g2's C API: no Arduino here, so the host tests draw the same frames.
//
// A frame has at most two lines: a big line in the largest font that fits, and a small line under it. In the top
// corners: the Pi's tag (P1, P2) as a white badge on the left; on the right, the link as a dot (filled = linked,
// hollow = not) and this board's LED as a small square while it's on. While the chip is held the screen is inverted
// with a bar sweeping along the bottom (faster while signing): black on white says "keep holding" from across a table.
// Done gets a check mark, fail a cross.
#pragma once

#include <clib/u8g2.h>
#include <string.h>

#include "feedback.h"
#include "screen_model.h"

namespace st {

constexpr int SCREEN_W = 72, SCREEN_H = 40;

struct ScreenView {
  Look look;
  const char *big, *small, *tag;
  bool linked, led;
  uint32_t sweep;  // the sweep's step
};

// Tallest first; the first that fits is used. At about the same height the bold fub comes before the condensed
// logisoso (thicker strokes read better across a table), logisoso takes over when fub is too wide, and the bold
// bitmap fonts at the end keep 8-10 characters legible.
static const uint8_t *const BIG_FONTS[] = {
    u8g2_font_logisoso28_tr, u8g2_font_fub25_tr,  u8g2_font_logisoso24_tr, u8g2_font_fub20_tr,
    u8g2_font_logisoso20_tr, u8g2_font_fub17_tr,  u8g2_font_logisoso18_tr, u8g2_font_logisoso16_tr,
    u8g2_font_fub14_tr,      u8g2_font_t0_17b_tr, u8g2_font_7x13B_tr,      u8g2_font_6x13B_tr,
    u8g2_font_5x8_tr,
};
constexpr int BIG_FONT_COUNT = sizeof BIG_FONTS / sizeof BIG_FONTS[0];
#define ST_SMALL_FONT u8g2_font_NokiaSmallBold_tr  // bold, proportional, one-row descenders: fits under the big line
#define ST_SMALL_FALLBACK u8g2_font_5x7_tr
#define ST_TAG_FONT u8g2_font_5x7_tr
constexpr int TOP = 9;       // the big line starts below the tag and the indicators (rows 0-7)
constexpr int BAR_ROWS = 2;  // the sweep along the bottom
constexpr int BAR_W = 18;
constexpr int ICON = 16;  // the check mark / cross, square
constexpr int ICON_GAP = 3;

// The index of the font that fits `s` in w x h (cap height); the last one, clipped, when none does.
inline int fitBigFont(u8g2_t *d, const char *s, int w, int h) {
  int i = 0;
  for (; i < BIG_FONT_COUNT; i++) {
    u8g2_SetFont(d, BIG_FONTS[i]);
    u8g2_SetFontRefHeightText(d);
    if (u8g2_GetAscent(d) <= h && u8g2_GetStrWidth(d, s) <= w) return i;
  }
  return BIG_FONT_COUNT - 1;
}

// Sets that font and returns the text's width. The last fit is kept, so redrawing the same text (a sweep step, an LED
// change) doesn't measure it in every font again.
inline int setBigFont(u8g2_t *d, const char *s, int w, int h) {
  static char fitS[BIG_MAX + 1];
  static int fitW = -1, fitH = -1, fitFont = -1;
  bool keep = strlen(s) <= BIG_MAX;
  int f = fitFont;
  if (!(keep && f >= 0 && w == fitW && h == fitH && !strcmp(s, fitS))) {
    f = fitBigFont(d, s, w, h);
    if (keep) {
      strcpy(fitS, s);
      fitW = w;
      fitH = h;
      fitFont = f;
    }
  }
  u8g2_SetFont(d, BIG_FONTS[f]);
  u8g2_SetFontRefHeightText(d);
  return u8g2_GetStrWidth(d, s);
}

// The small line, centred with its baseline at `y`: the bold font if it fits, else the narrow one, else cut with "..".
inline void drawSmall(u8g2_t *d, const char *s, int y) {
  u8g2_SetFont(d, ST_SMALL_FONT);
  if (u8g2_GetStrWidth(d, s) > SCREEN_W) u8g2_SetFont(d, ST_SMALL_FALLBACK);
  char buf[SMALL_MAX + 3];
  strncpy(buf, s, SMALL_MAX);
  buf[SMALL_MAX] = 0;
  for (size_t n = strlen(buf); n > 0 && u8g2_GetStrWidth(d, buf) > SCREEN_W; n--) strcpy(buf + n - 1, "..");
  u8g2_DrawStr(d, (SCREEN_W - u8g2_GetStrWidth(d, buf)) / 2, y, buf);
}

// A check mark or a cross, 3 px strokes, in the size x size square at (x, y).
inline void drawIcon(u8g2_t *d, bool check, int x, int y, int size) {
  int m = size - 1;
  for (int k = -1; k <= 1; k++) {
    if (check) {
      u8g2_DrawLine(d, x, y + m / 2 + k, x + m / 3, y + m * 5 / 6 + k);
      u8g2_DrawLine(d, x + m / 3, y + m * 5 / 6 + k, x + m, y + m / 6 + k);
    } else {
      u8g2_DrawLine(d, x + 1 + k, y + 1, x + m - 1 + k, y + m - 1);
      u8g2_DrawLine(d, x + m - 1 + k, y + 1, x + 1 + k, y + m - 1);
    }
  }
}

// Draws the frame into the buffer (the caller sends it).
inline void drawScreen(u8g2_t *d, const ScreenView &v) {
  bool sweep = v.look == LOOK_HOLD || v.look == LOOK_SIGN;
  bool icon = v.look == LOOK_DONE || v.look == LOOK_FAIL;
  const char *big = v.big ? v.big : "", *small = v.small ? v.small : "";
  u8g2_ClearBuffer(d);
  u8g2_SetFontMode(d, 0);
  u8g2_SetDrawColor(d, 1);
  if (v.tag && *v.tag) {  // white badge, black letters
    u8g2_SetFont(d, ST_TAG_FONT);
    u8g2_DrawRBox(d, 0, 0, u8g2_GetStrWidth(d, v.tag) + 4, 8, 1);
    u8g2_SetDrawColor(d, 0);
    u8g2_DrawStr(d, 2, 6, v.tag);
    u8g2_SetDrawColor(d, 1);
  }
  if (v.linked) u8g2_DrawDisc(d, SCREEN_W - 3, 2, 2, U8G2_DRAW_ALL);
  else u8g2_DrawCircle(d, SCREEN_W - 3, 2, 2, U8G2_DRAW_ALL);
  if (v.led) u8g2_DrawBox(d, SCREEN_W - 10, 1, 3, 3);

  // The small line sits at the bottom (above the sweep), its one-row descenders on the last row.
  int bottom = SCREEN_H - 1 - (sweep ? BAR_ROWS : 0);
  int bigBottom = bottom;
  if (*small) {
    int base = bottom - 1;
    drawSmall(d, small, base);
    bigBottom = base - 7 - 1;  // its caps are 7 rows, with one blank row above them
  }
  int left = icon ? ICON + ICON_GAP : 0;
  int areaH = bigBottom - TOP + 1;
  int w = 0, cap = 0;
  if (*big) {
    w = setBigFont(d, big, SCREEN_W - left, areaH);
    cap = u8g2_GetAscent(d);
  }
  if (icon) {  // the icon and the text centred together; the icon shrinks under a small line
    int size = areaH < ICON ? areaH : ICON;
    int x = (SCREEN_W - (*big ? size + ICON_GAP + w : size)) / 2;
    drawIcon(d, v.look == LOOK_DONE, x, TOP + (areaH - size) / 2, size);
    left = x + size + ICON_GAP;
  } else {
    left = (SCREEN_W - w) / 2;
  }
  if (*big) u8g2_DrawStr(d, left, TOP + (areaH - cap) / 2 + cap - 1, big);

  if (sweep) {
    int step = v.look == LOOK_SIGN ? 9 : 5;
    int x = (int)((v.sweep * (uint32_t)step) % (SCREEN_W + BAR_W)) - BAR_W;  // slides in from the left edge
    int bw = x < 0 ? BAR_W + x : BAR_W;
    if (bw > 0) u8g2_DrawBox(d, x < 0 ? 0 : x, SCREEN_H - BAR_ROWS, bw, BAR_ROWS);
    u8g2_SetDrawColor(d, 2);  // invert the lot
    u8g2_DrawBox(d, 0, 0, SCREEN_W, SCREEN_H);
    u8g2_SetDrawColor(d, 1);
  }
}

}  // namespace st
