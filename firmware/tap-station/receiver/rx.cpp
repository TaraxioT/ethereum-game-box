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

static Seen *pressSlot(const uint8_t mac[6]) {
  uint64_t m = egb::radio::macBits(mac);
  Seen *empty = nullptr;
  for (auto &s : seenPress) {
    if (s.mac == m) return &s;
    if (!s.mac && !empty) empty = &s;
  }
  if (!empty) empty = &seenPress[0];  // more stations than slots: forget one (a resend may toggle it twice)
  *empty = {m, 0};
  return empty;
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
  Msg m;
  m.type = Msg::PACKET;
  m.fresh = false;
  m.rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;
  memcpy(m.mac, src, 6);
  m.atUs = atUs;
  m.atMs = millis();
  m.len = (uint16_t)len;
  memcpy(m.data, d, len);
  // Whatever the loop must report goes to it before the ack: with the inbox full, no ack, and the station's resend
  // brings it again, instead of an acked tap that never reaches the Pi.
  if (kind == egb::K_PRESS) {  // a station's button: switch now, then ack (every copy, so a lost ack heals)
    egb::Press p;
    if (!egb::read(p, d, len)) return;
    Seen *seen = pressSlot(src);
    m.fresh = seen->id != p.id;
    if (!post(m)) return;
    if (m.fresh) {
      seen->id = p.id;
      setLed(!ledOn);
    }
    egb::Ack a;
    egb::head(a, egb::K_ACK, 0);
    a.h.tries = p.h.tries;
    a.id = p.id;
    a.t = p.t;
    reply(src, a);
  } else if (kind == egb::K_TAP || kind == egb::K_GONE || kind == egb::K_SIGNED) {
    if (len < (int)(sizeof(egb::Head) + 4) || !post(m)) return;
    egb::Got g;
    egb::head(g, egb::K_GOT, 0);
    g.h.tries = d[3];
    g.of = kind;
    memcpy(&g.id, d + sizeof(egb::Head), 4);
    reply(src, g);  // every copy, so a lost Got heals; the loop reports each id once
  } else if (kind == egb::K_PING) {  // the pong first: it times the link (a lost ping line costs nothing)
    egb::Ping p;
    if (!egb::read(p, d, len)) return;
    egb::Pong q;
    egb::head(q, egb::K_PONG, 0);
    q.seq = p.seq;
    q.t = p.t;
    reply(src, q);
    post(m);
  } else {
    if (kind == egb::K_ACK) {
      egb::Ack a;
      if (egb::read(a, d, len)) egb::press::onAck(a.id, atUs, a.h.flags, src);
    }
    post(m);
  }
}

}  // namespace rcv
