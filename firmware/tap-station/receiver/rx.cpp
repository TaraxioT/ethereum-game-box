#include "rx.h"

#include <atomic>

#include "inbox.h"

namespace rcv {

static std::atomic<bool> ledOn{false};

void ledBegin() {
  pinMode(PIN_LED_A, OUTPUT);
  pinMode(PIN_LED_B, OUTPUT);
  digitalWrite(PIN_LED_B, LOW);
  setLed(false);
}

void setLed(bool on) {
  ledOn = on;
  digitalWrite(PIN_LED_A, on ? HIGH : LOW);
  egb::radio::setFlag(egb::F_LED, on);
}

bool led() { return ledOn; }

// The last press id from each station, so a resend never toggles twice. Only the Wi-Fi task touches it.
struct Seen {
  uint64_t mac;
  uint32_t id;
};
static Seen seenPress[egb::MAX_STATIONS];

static bool freshPress(const uint8_t mac[6], uint32_t id) {
  uint64_t m = egb::radio::macBits(mac);
  Seen *slot = nullptr;
  for (auto &s : seenPress) {
    if (s.mac == m) {
      if (s.id == id) return false;
      s.id = id;
      return true;
    }
    if (!s.mac && !slot) slot = &s;
  }
  if (!slot) slot = &seenPress[0];  // more stations than slots: forget one (a resend may toggle it twice)
  *slot = {m, id};
  return true;
}

template <class T> static void reply(const uint8_t *to, T &p) {
  egb::radio::addPeer(to);
  egb::radio::send(to, &p, sizeof p);
}

void onRecv(const esp_now_recv_info_t *info, const uint8_t *d, int len) {
  uint32_t atUs = micros();
  uint8_t kind = egb::kindOf(d, len);
  if (!kind || len > (int)egb::PACKET_MAX) return;
  const uint8_t *src = info->src_addr;
  bool fresh = false;
  if (kind == egb::K_PRESS) {  // a station's button: switch now, then ack (every copy, so a lost ack heals)
    egb::Press p;
    if (!egb::read(p, d, len)) return;
    fresh = freshPress(src, p.id);
    if (fresh) setLed(!ledOn);
    egb::Ack a;
    egb::head(a, egb::K_ACK, 0);
    a.h.tries = p.h.tries;
    a.id = p.id;
    a.t = p.t;
    reply(src, a);
  } else if (kind == egb::K_ACK) {
    egb::Ack a;
    if (egb::read(a, d, len)) egb::press::onAck(a.id, atUs, a.h.flags, src);
  } else if (kind == egb::K_PING) {
    egb::Ping p;
    if (!egb::read(p, d, len)) return;
    egb::Pong q;
    egb::head(q, egb::K_PONG, 0);
    q.seq = p.seq;
    q.t = p.t;
    reply(src, q);
  } else if (kind == egb::K_TAP || kind == egb::K_GONE || kind == egb::K_SIGNED) {
    if (len < (int)(sizeof(egb::Head) + 4)) return;
    egb::Got g;
    egb::head(g, egb::K_GOT, 0);
    g.h.tries = d[3];
    g.of = kind;
    memcpy(&g.id, d + sizeof(egb::Head), 4);
    reply(src, g);
  }
  Msg m;
  m.type = Msg::PACKET;
  m.fresh = fresh;
  m.rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;
  memcpy(m.mac, src, 6);
  m.atUs = atUs;
  m.atMs = millis();
  m.len = (uint16_t)len;
  memcpy(m.data, d, len);
  post(m);
}

}  // namespace rcv
