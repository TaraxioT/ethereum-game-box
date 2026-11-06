// The receiver's table of stations: who they are, whether their link is up, and what the Pi was last told about each.
// Owned by the receiver's loop task alone. Plain C++, tested on the host.
#pragma once

#include <stdint.h>
#include <string.h>

#include "config.h"
#include "wire.h"

namespace egb {

struct Station {
  uint8_t mac[6];
  char name[7];  // the MAC's last three bytes, lower-case hex: `e4ba70`
  bool used;
  bool up;         // the Pi was told the link is up
  uint32_t heardMs;  // any packet counts, not only pings
  uint8_t flags;     // the station's F_* as last reported to the Pi
  int8_t rssi;
  uint32_t tapId, goneId, signedId, reportId;  // the last of each the Pi was told about (each id counts once)
  bool tapSeen, goneSeen, signedSeen;
  uint32_t boot;  // the station's boot its tap ids count from
  bool bootSeen;
  bool chipOn;
  Chip chip;  // the chip on its reader, for `state`
  // The station's last NFC request, so its `signed` line carries the caller's id even after the reply freed the slot.
  uint32_t nfcWire, nfcCaller;
};

// Whether a reliable packet's id is new: each counts once, and an old one resent after a newer one (its Got was lost,
// a newer packet got through first) is dropped, comparing across the counter's wrap.
inline bool fresh(uint32_t id, uint32_t &last, bool &seen) {
  if (seen && (int32_t)(id - last) <= 0) return false;
  last = id;
  seen = true;
  return true;
}

// A station's tap ids count from a random start each boot: a new boot starts its taps and gones afresh.
inline void bootOf(Station &s, uint32_t boot) {
  if (s.bootSeen && boot == s.boot) return;
  s.boot = boot;
  s.bootSeen = true;
  s.tapSeen = s.goneSeen = false;
}

class Stations {
 public:
  Station at[MAX_STATIONS] = {};

  int find(const uint8_t mac[6]) const {
    for (int i = 0; i < MAX_STATIONS; i++)
      if (at[i].used && !memcmp(at[i].mac, mac, 6)) return i;
    return -1;
  }

  // The station with this MAC, added on first sight; -1 when the table is full.
  int findOrAdd(const uint8_t mac[6]) {
    int i = find(mac);
    if (i >= 0) return i;
    for (i = 0; i < MAX_STATIONS; i++) {
      if (at[i].used) continue;
      Station &s = at[i];
      memset(&s, 0, sizeof s);
      memcpy(s.mac, mac, 6);
      static const char D[] = "0123456789abcdef";
      for (int k = 0; k < 3; k++) {
        s.name[2 * k] = D[mac[3 + k] >> 4];
        s.name[2 * k + 1] = D[mac[3 + k] & 15];
      }
      s.used = true;
      return i;
    }
    return -1;
  }

  // A linked station by name (lower or upper case), or -1.
  int linkedNamed(const char *name, uint32_t nowMs) const {
    for (int i = 0; i < MAX_STATIONS; i++) {
      if (!linked(i, nowMs)) continue;
      bool same = true;
      for (int k = 0; k < 7 && same; k++) {
        char c = name[k];
        if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
        same = c == at[i].name[k];
        if (!c) break;
      }
      if (same) return i;
    }
    return -1;
  }

  bool linked(int i, uint32_t nowMs) const {
    return at[i].used && sinceMs(nowMs, at[i].heardMs) < (int32_t)LINK_TIMEOUT_MS;
  }

  // The first linked station (where the receiver's own presses go), or -1.
  int firstLinked(uint32_t nowMs) const {
    for (int i = 0; i < MAX_STATIONS; i++)
      if (linked(i, nowMs)) return i;
    return -1;
  }
};

}  // namespace egb
