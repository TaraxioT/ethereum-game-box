// Splits the serial input into command lines, and recovers a command glued to junk.
//
// Why junk arrives: a freshly enumerated USB tty (the board was just plugged in, power-cycled or flashed) starts in
// cooked mode with echo on. Between the host's open() and its switch to raw mode, Linux echoes every byte the board
// sends straight back to it, so the board reads fragments of its own output. The last fragment usually ends mid-line,
// and the host's first real command is appended to it: `{"ev":"ping","st":"e4b` + `state`. Commands are only letters,
// digits and spaces, and every byte of the board's output lines that isn't one ({ " : , }) marks junk; the command
// is then the text after the last such byte, its first word stripped of any glued prefix (`e4bstate` -> `state`).
// Plain C++, tested on the host.
#pragma once

#include <stddef.h>
#include <string.h>

namespace egb {

inline bool commandChar(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ';
}

struct Line {
  const char *text;  // NUL-terminated
  size_t len;
  size_t junkEnd;  // just past the last byte that can't be in a command; 0 when there was none
  bool tooLong;    // more than the reader holds: the line is cut and should be refused
};

template <size_t MAX> class LineReader {
 public:
  // One byte in; true when a line is complete (then line() is valid until the next feed).
  bool feed(char c) {
    if (c == '\r') return false;  // lines from the Pi may end in \r\n
    if (c == '\n') {
      buf_[len_] = 0;
      done_ = {buf_, len_, junkEnd_, over_};
      len_ = junkEnd_ = 0;
      over_ = false;
      return true;
    }
    if (len_ >= MAX) {
      over_ = true;
      return false;
    }
    buf_[len_++] = c;
    if (!commandChar(c)) junkEnd_ = len_;
    return false;
  }
  const Line &line() const { return done_; }

 private:
  char buf_[MAX + 1];
  size_t len_ = 0, junkEnd_ = 0;
  bool over_ = false;
  Line done_ = {buf_, 0, 0, false};
};

// The command in a line: the line itself when it's clean; after junk, the text past the junk with its first word cut
// down to the command word it ends with. nullptr when there is no command in it (pure echo: ignore it silently).
inline const char *unglue(const Line &l, const char *const *words, size_t nWords) {
  if (!l.junkEnd) return l.text;
  const char *s = l.text + l.junkEnd;
  while (*s == ' ') s++;
  size_t w = 0;
  while (s[w] && s[w] != ' ') w++;
  for (size_t i = 0; i < nWords; i++) {
    size_t n = strlen(words[i]);
    if (n <= w && !memcmp(s + w - n, words[i], n)) return s + w - n;
  }
  return nullptr;
}

}  // namespace egb
