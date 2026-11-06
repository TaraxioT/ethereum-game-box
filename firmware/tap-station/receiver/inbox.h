// The receiver's loop task owns everything that isn't latency-critical (the station table, the resend slots, every
// line to the Pi); the other tasks hand it their news through this one queue, which is also what wakes it.
#pragma once

#include <EgbLink.h>

namespace rcv {

struct Msg {
  enum Type : uint8_t {
    PACKET,  // from the radio callback: a station's packet (data, len), stamped on arrival
    PRESS,   // from the press task: how our own press is going
    BUTTON,  // from the press task: our BOOT went down or came up
    SERIAL_IN,  // from the USB event task: bytes from the Pi are waiting
  } type;
  bool fresh;  // PACKET, a station's press: new (the LED switched), not a resend
  bool down;   // BUTTON
  int8_t rssi;
  uint8_t mac[6];
  uint32_t atUs, atMs;
  uint16_t len;
  egb::press::Outcome press;
  uint8_t data[egb::PACKET_MAX];
};

void inboxBegin();
bool post(const Msg &m);  // never waits: a full inbox drops the message

// The loop's wait: the next message, or nothing within `ms`.
bool next(Msg &m, uint32_t ms);

}  // namespace rcv
