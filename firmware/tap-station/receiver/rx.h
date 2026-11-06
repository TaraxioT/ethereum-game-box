// The receiver's radio callback: the latency-critical answers go straight back from the Wi-Fi task (a station's press
// switches LED A before the ack; pings get their pong; taps, gones and signatures their Got), and every packet goes on
// to the loop through the inbox.
#pragma once

#include <EgbLink.h>

namespace rcv {

constexpr uint8_t PIN_LED_A = 12;  // GPIO12/13 are free because the flash runs in DIO mode
constexpr uint8_t PIN_LED_B = 13;  // kept off

void ledBegin();
void setLed(bool on);
bool led();

void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len);

}  // namespace rcv
