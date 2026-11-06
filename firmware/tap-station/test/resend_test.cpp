// The resend slot on a fake clock.
#include "check.h"
#include "egb/resend.h"

using namespace egb;

static const uint8_t TO[6] = {1, 2, 3, 4, 5, 6};

static Slot packetSlot(uint32_t startMs, Policy p) {
  Buzz b;
  head(b, K_BUZZ, 0);
  b.id = 77;
  Slot s = {};
  s.start(&b, sizeof b, TO, p, startMs, startMs * 1000);
  return s;
}

TEST(a_packet_goes_every_20_ms_25_times_then_expires) {
  Slot s = packetSlot(1000, POLICY_PACKET);
  CHECK_EQ(s.kind, (uint8_t)K_BUZZ);
  CHECK_EQ(s.id, 77u);
  CHECK_EQ(s.buf[3], 1);  // the first send's tries
  int sends = 1;
  uint32_t lastSend = 1000, expiredAt = 0;
  for (uint32_t t = 1000; t < 2000 && !expiredAt; t++) {
    Slot::Due d = s.poll(t);
    if (d == Slot::SEND) {
      CHECK_EQ(t - lastSend, 20u);
      lastSend = t;
      sends++;
      CHECK_EQ(s.buf[3], sends);
    } else if (d == Slot::EXPIRED) {
      expiredAt = t;
    }
  }
  CHECK_EQ(sends, 25);
  CHECK_EQ(expiredAt, 1000u + 25 * 20);
  CHECK(!s.used);
  CHECK_EQ(s.poll(5000), Slot::IDLE);
}

TEST(an_nfc_request_goes_every_40_ms_until_3_s) {
  Slot s = packetSlot(0, POLICY_NFC);
  int sends = 1;
  uint32_t expiredAt = 0;
  for (uint32_t t = 0; t < 4000 && !expiredAt; t++) {
    Slot::Due d = s.poll(t);
    if (d == Slot::SEND) sends++;
    if (d == Slot::EXPIRED) expiredAt = t;
  }
  CHECK_EQ(expiredAt, 3000u);
  CHECK_EQ(sends, 75);  // 0, 40, ... 2960
}

TEST(due_in_says_when_to_wake) {
  Slot s = packetSlot(100, POLICY_SCREEN);
  CHECK_EQ(s.dueInMs(100), 40);
  CHECK_EQ(s.dueInMs(130), 10);
  CHECK_EQ(s.dueInMs(150), 0);  // late: now
  s.poll(140);
  CHECK_EQ(s.dueInMs(140), 40);
  Slot idle = {};
  CHECK_EQ(idle.dueInMs(0), -1);
}

TEST(the_clock_wraps) {
  Slot s = packetSlot(0xFFFFFFF0u, POLICY_PACKET);
  CHECK_EQ(s.poll(0xFFFFFFFFu), Slot::WAIT);
  CHECK_EQ(s.poll(4), Slot::SEND);  // 20 ms later, across the wrap
}

TEST(a_pool_finds_and_takes) {
  Pool<3> pool = {};
  Slot *a = pool.free();
  *a = packetSlot(0, POLICY_SCREEN);
  a->station = 1;
  CHECK(pool.find(1, K_BUZZ) == a);
  CHECK(pool.find(2, K_BUZZ) == nullptr);
  CHECK(pool.take(1, K_BUZZ, 78) == nullptr);  // a late ack for another id
  CHECK(pool.take(1, K_BUZZ, 77) == a);
  CHECK(!a->used);
  CHECK(pool.take(1, K_BUZZ, 77) == nullptr);  // only once
  CHECK_EQ(pool.dueInMs(0), -1);
}

TEST(chip_events_go_until_the_pi_stops_waiting) {
  Slot s = packetSlot(0, POLICY_CHIP_EVENT);
  int sends = 1;
  uint32_t expiredAt = 0;
  for (uint32_t t = 0; t < 10000 && !expiredAt; t++) {
    Slot::Due d = s.poll(t);
    if (d == Slot::SEND) sends++;
    if (d == Slot::EXPIRED) expiredAt = t;
  }
  CHECK_EQ(expiredAt, (uint32_t)(LINK_TIMEOUT_MS + PI_GRACE_MS));
  CHECK_EQ(sends, 225);
}

TEST(a_full_pool_gives_the_oldest_slot_to_the_new_packet) {
  Pool<3> pool = {};
  for (uint32_t t : {100u, 50u, 200u}) *pool.free() = packetSlot(t, POLICY_CHIP_EVENT);
  CHECK(pool.free() == nullptr);
  CHECK_EQ(pool.freeOrOldest()->startMs, 50u);
}
