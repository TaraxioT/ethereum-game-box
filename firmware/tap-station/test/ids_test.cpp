// Each tap, gone and signature counts once, newer only, per station boot; requests bound to a tap; the gap window.
#include "check.h"
#include "egb/stations.h"
#include "timing.h"

using namespace egb;

TEST(ids_count_once_and_newer_only) {
  uint32_t last = 0;
  bool seen = false;
  CHECK(fresh(0xF0000000u, last, seen));  // the first id ever, whatever it is
  CHECK(!fresh(0xF0000000u, last, seen));  // its resend
  CHECK(fresh(0xF0000001u, last, seen));
  CHECK(!fresh(0xF0000000u, last, seen));  // the older one resent after the newer: dropped
  last = 0xFFFFFFFFu;
  CHECK(fresh(0u, last, seen));             // across the wrap
  CHECK(!fresh(0xFFFFFFFFu, last, seen));
}

TEST(a_rebooted_station_starts_its_count_again) {
  Station s = {};
  bootOf(s, 7);
  CHECK(fresh(1000, s.tapId, s.tapSeen));
  CHECK(fresh(1001, s.tapId, s.tapSeen));
  bootOf(s, 7);
  CHECK(!fresh(1000, s.tapId, s.tapSeen));
  bootOf(s, 8);                              // a new boot, its count from a new random start
  CHECK(fresh(5, s.tapId, s.tapSeen));
}

TEST(a_request_is_for_the_chip_of_its_tap) {
  NfcReq q = {};
  CHECK(!forOtherChip(q, 41));  // unbound (the receiver saw no tap yet): any chip
  q.bound = 1;
  q.tap = 41;
  CHECK(!forOtherChip(q, 41));
  CHECK(forOtherChip(q, 42));  // another chip landed since
}

TEST(the_gap_is_one_detection_at_most) {
  CHECK_EQ(st::gapUs(1000, 0), 1000u);
  CHECK_EQ(st::gapUs(30000000, 0), st::GAP_MAX_US);  // the first read after boot
  CHECK_EQ(st::gapUs(5, 0xFFFFFFF0u), 21u);           // across the wrap
}
