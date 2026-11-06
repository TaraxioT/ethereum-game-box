#include "cli.h"

#include <Arduino.h>

#include "motor.h"
#include "oled.h"
#include "reader.h"
#include "stats.h"

namespace st {
namespace cli {

static const char *const WORDS[] = {"press", "buzz", "stats", "frame", "bench"};

static bool word(const char *&s, const char *name) {
  size_t n = strlen(name);
  if (strncmp(s, name, n) || (s[n] && s[n] != ' ')) return false;
  s += n;
  while (*s == ' ') s++;
  return true;
}

static void say(const char *text) { egb::serial::line(text, strlen(text)); }

void line(const egb::Line &l) {
  const char *s = egb::unglue(l, WORDS, sizeof WORDS / sizeof WORDS[0]);  // a fresh tty echoes our output back
  if (!s) return;
  while (*s == ' ') s++;
  if (word(s, "press")) {
    egb::press::trigger(0);
  } else if (word(s, "buzz")) {
    long ms = *s ? atol(s) : egb::BUZZ_MS_DEFAULT;
    motor::buzz((uint16_t)(ms > 0 && ms <= egb::BUZZ_MS_MAX ? ms : egb::BUZZ_MS_DEFAULT));
  } else if (word(s, "stats")) {
    egb::StatsRes r = stats();
    char out[128];
    snprintf(out, sizeof out, "stats loop=%u nfc=%u oled=%u press=%u dropped=%lu send_fails=%lu up_ms=%lu\n",
             r.stack[egb::T_LOOP], r.stack[egb::T_NFC], r.stack[egb::T_OLED], r.stack[egb::T_PRESS],
             (unsigned long)r.dropped, (unsigned long)r.sendFails, (unsigned long)r.upMs);
    say(out);
  } else if (word(s, "frame")) {
    oled::frame();
  } else if (word(s, "bench")) {
    char what[16] = {};
    for (size_t k = 0; *s && *s != ' ' && k < sizeof what - 1;) what[k++] = *s++;
    long n = atol(s);
    reader::bench(what, (uint16_t)(n > 0 && n < 1000 ? n : 20));
  } else if (*s) {
    say("commands: press | buzz [ms] | stats | frame | bench <read|rats|select|present|list|lift> [n]\n");
  }
}

}  // namespace cli
}  // namespace st
