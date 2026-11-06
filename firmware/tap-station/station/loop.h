// The station's loop task: it owns the resend slots, sends the pings and the press reports, answers stats and the
// station's own serial port, and sleeps on its inbox until one of those has news or a resend falls due.
#pragma once

#include <EgbLink.h>

namespace st {

struct LoopMsg {
  enum Type : uint8_t {
    GOT,       // from the radio callback: the receiver took one of ours
    STATS,     // from the radio callback: a stats request
    RELIABLE,  // from the NFC task: a packet whose first copy just went out, to resend until its Got
    PRESS,     // from the press task: how this board's press went
    SERIAL_IN,  // from the USB event task: a command on the station's own port
  } type;
  uint16_t len;
  egb::press::Outcome press;
  uint8_t data[sizeof(egb::Signed) + 8];
};

void loopPost(const LoopMsg &m);

}  // namespace st
