// Draws one OLED frame (72x40) with U8g2's C API: no Arduino here, so the host tests draw the same frames.
//
// A frame has at most two lines: a big line in the largest font that fits, and a small line under it. In the top
// corners: the Pi's tag (P1, P2) as a white badge on the left; on the right, the link as a dot (filled = linked,
// hollow = not) and this board's LED as a small square while it's on. While the chip is held the screen is inverted
// with a bar sweeping along the bottom (faster while signing): black on white says "keep holding" from across a table.
// Done gets a check mark, fail and NOT NOW a cross. A line too long for the screen (an ENS name) scrolls as a
// marquee: it rests at the left edge, slides out to the left, and comes round again, its next copy following a gap
// behind. In the top right, beside the LED square, a padlock says taps aren't welcome (mode=shut) and a play
// triangle that a game waits for this station (mode=play).
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
  uint8_t mode;    // Mode: the padlock or the play triangle
  uint32_t tick;   // the marquee's step since the text last changed (0 while nothing scrolls)
};

constexpr uint32_t SCROLL_MS = 30;     // the marquee's step: ~33 frames a second ...
constexpr int SCROLL_PX = 2;           // ... of 2 px: ~67 px a second, about four big letters
constexpr int SCROLL_GAP = 18;         // between the end of the text and its next copy
constexpr uint32_t SCROLL_REST = 25;   // steps resting at the left edge each time round (0.75 s)
constexpr size_t BIG_FIT = 10;         // a big line this long or shorter never scrolls: the fonts go down to fit it
constexpr int SCROLL_FONT_MIN = 8;     // a longer one that needs a font smaller than this one (fub14) scrolls

// The marquee's offset at step `tick` for text `textW` wide: resting, then sliding one copy's length.
inline int scrollOffset(uint32_t tick, int textW) {
  uint32_t slide = (uint32_t)(textW + SCROLL_GAP + SCROLL_PX - 1) / SCROLL_PX;
  uint32_t t = tick % (SCROLL_REST + slide);
  return t < SCROLL_REST ? 0 : (int)((t - SCROLL_REST) * SCROLL_PX);
}

// Draws `str` scrolled into the window x0..x0+w (baseline y, `top`..`bottom` rows), clipped to it.
inline void drawMarquee(u8g2_t *d, const char *str, int x0, int w, int y, int top, int bottom, uint32_t tick) {
  int tw = u8g2_GetStrWidth(d, str);
  int x = x0 - scrollOffset(tick, tw);
  u8g2_SetClipWindow(d, x0, top, x0 + w, bottom + 1);
  u8g2_DrawStr(d, x, y, str);
  u8g2_DrawStr(d, x + tw + SCROLL_GAP, y, str);
  u8g2_SetMaxClipWindow(d);
}

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
#define ST_SMALL_SCROLL_FONT u8g2_font_fub11_tr  // a small line that scrolls: big, bold letters (11 px caps)
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

// The big line's font: the largest that fits, down to the smallest for up to BIG_FIT characters. A longer line that
// would need a font under SCROLL_FONT_MIN scrolls instead, in the tallest font the height takes (`scroll` says so).
inline int bigFontFor(u8g2_t *d, const char *s, int w, int h, bool &scroll) {
  int f = fitBigFont(d, s, w, h);
  scroll = strlen(s) > BIG_FIT && (f > SCROLL_FONT_MIN || (f == BIG_FONT_COUNT - 1 && u8g2_GetStrWidth(d, s) > w));
  if (scroll) f = fitBigFont(d, s, 0x7fff, h);
  return f;
}

// Sets that font and returns the text's width. The last fit is kept, so redrawing the same text (a sweep step, a
// marquee step, an LED change) doesn't measure it in every font again.
inline int setBigFont(u8g2_t *d, const char *s, int w, int h, bool &scroll) {
  static char fitS[BIG_MAX + 1];
  static int fitW = -1, fitH = -1, fitFont = -1;
  static bool fitScroll = false;
  bool keep = strlen(s) <= BIG_MAX;
  int f = fitFont;
  scroll = fitScroll;
  if (!(keep && f >= 0 && w == fitW && h == fitH && !strcmp(s, fitS))) {
    f = bigFontFor(d, s, w, h, scroll);
    if (keep) {
      strcpy(fitS, s);
      fitW = w;
      fitH = h;
      fitFont = f;
      fitScroll = scroll;
    }
  }
  u8g2_SetFont(d, BIG_FONTS[f]);
  u8g2_SetFontRefHeightText(d);
  return u8g2_GetStrWidth(d, s);
}

// Whether the small line is too wide for the screen even in the narrow font: then it scrolls, in big letters.
inline bool smallScrolls(u8g2_t *d, const char *s) {
  u8g2_SetFont(d, ST_SMALL_FALLBACK);
  return u8g2_GetStrWidth(d, s) > SCREEN_W;
}

// The small line with its baseline at `y`, centred: the bold font if it fits, else the narrow one.
inline void drawSmall(u8g2_t *d, const char *s, int y) {
  u8g2_SetFont(d, ST_SMALL_FONT);
  if (u8g2_GetStrWidth(d, s) > SCREEN_W) u8g2_SetFont(d, ST_SMALL_FALLBACK);
  u8g2_DrawStr(d, (SCREEN_W - u8g2_GetStrWidth(d, s)) / 2, y, s);
}

// A padlock (taps not welcome) or a play triangle (a game waits for this station), 6 x 7 at (x, 0).
inline void drawModeIcon(u8g2_t *d, uint8_t mode, int x) {
  if (mode == MODE_SHUT) {
    u8g2_DrawFrame(d, x + 1, 0, 4, 4);
    u8g2_DrawBox(d, x, 3, 6, 4);
  } else if (mode == MODE_PLAY) {
    u8g2_DrawTriangle(d, x + 1, 0, x + 1, 7, x + 5, 3);
  }
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

// Draws the frame into the buffer (the caller sends it). Returns whether a line scrolls: the caller draws again every
// SCROLL_MS, with the next tick.
inline bool drawScreen(u8g2_t *d, const ScreenView &v) {
  bool sweep = v.look == LOOK_HOLD || v.look == LOOK_SIGN;
  bool icon = v.look == LOOK_DONE || v.look == LOOK_FAIL || v.look == LOOK_NOPE;
  bool scrolls = false;
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
  if (v.look == LOOK_IDLE) drawModeIcon(d, v.mode, SCREEN_W - 18);

  // The small line sits at the bottom (above the sweep), its one-row descenders on the last row.
  int bottom = SCREEN_H - 1 - (sweep ? BAR_ROWS : 0);
  int bigBottom = bottom;
  if (*small) {
    int base = bottom - 1;
    if (smallScrolls(d, small)) {  // in big letters, the big line giving up the rows
      u8g2_SetFont(d, ST_SMALL_SCROLL_FONT);
      u8g2_SetFontRefHeightText(d);
      int cap = u8g2_GetAscent(d);
      base = bottom + u8g2_GetDescent(d);  // its descenders on the last row
      drawMarquee(d, small, 0, SCREEN_W, base, base - cap, bottom, v.tick);
      bigBottom = base - cap - 2;
      scrolls = true;
    } else {
      drawSmall(d, small, base);
      bigBottom = base - 7 - 1;  // its caps are 7 rows, with one blank row above them
    }
  }
  int left = icon ? ICON + ICON_GAP : 0;
  int areaH = bigBottom - TOP + 1;
  int w = 0, cap = 0;
  bool bigScrolls = false;
  if (*big) {
    w = setBigFont(d, big, SCREEN_W - left, areaH, bigScrolls);
    cap = u8g2_GetAscent(d);
  }
  if (icon) {  // the icon and the text centred together (a scrolling text: the icon at the left); it shrinks under a small line
    int size = areaH < ICON ? areaH : ICON;
    int x = bigScrolls ? 0 : (SCREEN_W - (*big ? size + ICON_GAP + w : size)) / 2;
    drawIcon(d, v.look == LOOK_DONE, x, TOP + (areaH - size) / 2, size);
    left = x + size + ICON_GAP;
  } else {
    left = bigScrolls ? 0 : (SCREEN_W - w) / 2;
  }
  int baseline = TOP + (areaH - cap) / 2 + cap - 1;
  if (*big && bigScrolls) {
    // The font was set by setBigFont; the window spans the big line's rows.
    drawMarquee(d, big, left, SCREEN_W - left, baseline, TOP, bigBottom, v.tick);
    scrolls = true;
  } else if (*big) {
    u8g2_DrawStr(d, left, baseline, big);
  }

  if (sweep) {
    int step = v.look == LOOK_SIGN ? 9 : 5;
    int x = (int)((v.sweep * (uint32_t)step) % (SCREEN_W + BAR_W)) - BAR_W;  // slides in from the left edge
    int bw = x < 0 ? BAR_W + x : BAR_W;
    if (bw > 0) u8g2_DrawBox(d, x < 0 ? 0 : x, SCREEN_H - BAR_ROWS, bw, BAR_ROWS);
    u8g2_SetDrawColor(d, 2);  // invert the lot
    u8g2_DrawBox(d, 0, 0, SCREEN_W, SCREEN_H);
    u8g2_SetDrawColor(d, 1);
  }
  return scrolls;
}

}  // namespace st
