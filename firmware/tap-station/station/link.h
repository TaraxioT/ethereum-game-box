// The station's side of the radio. The receive callback (Wi-Fi task) answers what can't wait: the receiver's press
// switches the LED before the ack, a buzz starts the motor before its Got, a screen is acked and handed to the OLED
// task, an NFC request goes to the NFC task. Acks and stats requests go to the loop task, which owns the resend
// slots and sends the pings.
#pragma once

#include <EgbLink.h>

namespace st {
namespace link {

bool begin();  // false: ESP-NOW didn't start

// The receiver, once a packet from one arrived (broadcast until then).
void receiver(uint8_t mac[6]);
bool linked(uint32_t nowMs);
uint32_t heardMs();
uint32_t pingRttUs();

// To the receiver, once (an NFC reply: the receiver resends the request if it's lost).
void send(void *packet, size_t len);
// To the receiver until its Got: the first copy now, then the loop task resends (taps, gones, signatures).
void sendReliable(void *packet, size_t len);

}  // namespace link
}  // namespace st
