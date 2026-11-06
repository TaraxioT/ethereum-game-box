#include "link.h"

#include <atomic>

#include "led.h"
#include "loop.h"
#include "motor.h"
#include "oled.h"
#include "reader.h"

namespace st {
namespace link {

using namespace egb;

static std::atomic<uint64_t> receiverMac{0};  // 0: none yet
static std::atomic<uint32_t> lastHeardMs{0}, rttUs{0};
static std::atomic<bool> known{false};

void receiver(uint8_t mac[6]) {
  if (known) radio::macBytes(receiverMac.load(), mac);
  else memcpy(mac, radio::BROADCAST, 6);
}

bool linked(uint32_t nowMs) { return known && sinceMs(nowMs, lastHeardMs) < (int32_t)LINK_TIMEOUT_MS; }
uint32_t heardMs() { return lastHeardMs; }
uint32_t pingRttUs() { return rttUs; }

void send(void *packet, size_t len) {
  uint8_t to[6];
  receiver(to);
  radio::send(to, packet, len);
}

void sendReliable(void *packet, size_t len) {
  LoopMsg m;
  m.type = LoopMsg::RELIABLE;
  m.len = (uint16_t)len;
  memcpy(m.data, packet, len);
  loopPost(m);  // first, so the loop has the slot before the Got can come back
  send(packet, len);
}

template <class T> static void reply(const uint8_t *to, T &p) { radio::send(to, &p, sizeof p); }

static void got(const uint8_t *to, uint8_t kind, uint32_t id, uint8_t tries) {
  Got g;
  head(g, K_GOT, 0);
  g.h.tries = tries;
  g.of = kind;
  g.id = id;
  reply(to, g);
}

static void onRecv(const esp_now_recv_info_t *info, const uint8_t *d, int len) {
  uint32_t atUs = micros();
  uint8_t kind = kindOf(d, len);
  // Only the receiver's packets: another station's broadcasts (pings, presses before it found the receiver) are not
  // for us.
  if (!kind || !(d[2] & F_RECEIVER)) return;
  const uint8_t *src = info->src_addr;
  if (!known || receiverMac.load() != radio::macBits(src)) {
    radio::addPeer(src);
    receiverMac = radio::macBits(src);
    known = true;
  }
  lastHeardMs = millis();
  switch (kind) {
    case K_PONG: {
      Pong p;
      if (read(p, d, len)) rttUs = atUs - p.t;
      break;
    }
    case K_PRESS: {  // the receiver's button: switch now, then ack (every copy, so a lost ack heals)
      static uint32_t lastId = 0;  // only the Wi-Fi task runs this
      Press p;
      if (!read(p, d, len)) break;
      if (p.id != lastId) {
        lastId = p.id;
        led::toggleMine();
      }
      Ack a;
      head(a, K_ACK, 0);
      a.h.tries = p.h.tries;
      a.id = p.id;
      a.t = p.t;
      reply(src, a);
      break;
    }
    case K_ACK: {
      Ack a;
      if (read(a, d, len)) press::onAck(a.id, atUs, a.h.flags, src);
      break;
    }
    case K_BUZZ: {
      static uint32_t lastId = 0;
      Buzz b;
      if (!read(b, d, len)) break;
      if (b.id != lastId) {  // a resend of one already running only needs its Got again
        lastId = b.id;
        motor::buzz(b.ms < BUZZ_MS_MAX ? b.ms : BUZZ_MS_MAX, b.pulses < BUZZ_PULSES_MAX ? b.pulses : BUZZ_PULSES_MAX);
      }
      got(src, K_BUZZ, b.id, b.h.tries);
      break;
    }
    case K_SCREEN: {
      static Screen s;  // only the Wi-Fi task runs this
      if (!read(s, d, len)) break;
      oled::screenIn(s);  // keeps only the newest; a resend of the one it has is ignored there
      got(src, K_SCREEN, s.id, s.h.tries);
      break;
    }
    case K_NFC_REQ: {
      static NfcReq q;
      if (read(q, d, len)) reader::request(q, src);
      break;
    }
    case K_GOT:
    case K_STATS_REQ: {
      LoopMsg m;
      m.type = kind == K_GOT ? LoopMsg::GOT : LoopMsg::STATS;
      m.len = (uint16_t)(len < (int)sizeof m.data ? len : sizeof m.data);
      memcpy(m.data, d, m.len);
      loopPost(m);
      break;
    }
    default:
      break;
  }
}

bool begin() { return radio::begin(onRecv); }

}  // namespace link
}  // namespace st
