// The BOOT button as a press for the other board: an edge interrupt wakes a high-priority task that sends the press
// at once and resends it every 20 ms (25 sends at most) until the ack. The other board switches its LED in its receive
// callback before acking, so the light changes about half a round trip after the press.
//
// The press task owns the press in flight. The receive callback hands it acks (onAck), the board hands it presses
// from its serial port (trigger), and it reports each press's start and end to the board through `report`, which runs
// in the press task and must only queue.
#pragma once

#include <Arduino.h>

namespace egb {
namespace press {

struct Outcome {
  enum What : uint8_t { STARTED, ACKED, FAILED } what;
  uint32_t ref;    // the caller's id (`press <id>`), or the press's own id for the button
  uint32_t atUs;   // micros() at the first send
  uint32_t rttUs;  // ACKED: first send to ack
  uint8_t sends;
  uint8_t peerFlags;  // ACKED: the other board's flags (its LED)
  uint8_t peer[6];    // ACKED: who acked
};

using Report = void (*)(const Outcome &);
using Peer = void (*)(uint8_t mac[6]);  // where presses go now
using Button = void (*)(bool down);     // the button went down or came up (in the press task)

void begin(uint8_t pin, Peer peer, Report report, Button button);

// A press from the serial port; `ref` comes back in its outcomes (0: the press's own id).
void trigger(uint32_t ref);

// In the receive callback: an Ack (its id, its echoed t, the sender's flags), stamped with micros() on arrival.
void onAck(uint32_t id, uint32_t nowUs, uint8_t flags, const uint8_t from[6]);

bool down();  // the button, debounced

UBaseType_t stackLeft();  // the press task's lowest free stack, bytes

}  // namespace press
}  // namespace egb
