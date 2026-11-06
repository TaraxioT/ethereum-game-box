#include "radio.h"

#include <WiFi.h>
#include <esp_wifi.h>

namespace egb {
namespace radio {

const uint8_t BROADCAST[6] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
std::atomic<uint8_t> myFlags{0};
static std::atomic<uint32_t> sendFailCount{0}, rateFailCount{0};

// A unicast frame the peer never acked at the radio level, after the MAC's own retries: counted with the refusals.
static void onSent(const esp_now_send_info_t *, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS) sendFailCount++;
}

bool begin(esp_now_recv_cb_t onRecv) {
  // WiFi.setSleep first: Arduino applies its own sleep setting again when the station interface starts, after mode()
  // has returned, and that would otherwise be its default, modem sleep (tens of ms added to unsolicited packets).
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(CHANNEL, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(onRecv);
  esp_now_register_send_cb(onSent);
  return addPeer(BROADCAST);
}

bool addPeer(const uint8_t mac[6]) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = 0;  // the current channel
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_err_t err = esp_now_add_peer(&peer);
  if (err == ESP_ERR_ESPNOW_EXIST) return true;  // another task added it meanwhile
  if (err != ESP_OK) return false;
  if (memcmp(mac, BROADCAST, 6) != 0) {
    esp_now_rate_config_t rate = {};
    rate.phymode = WIFI_PHY_MODE_11G;
    rate.rate = WIFI_PHY_RATE_24M;
    if (esp_now_set_peer_rate_config(mac, &rate) != ESP_OK) rateFailCount++;
  }
  return true;
}

bool send(const uint8_t to[6], void *packet, size_t len) {
  ((Head *)packet)->flags = myFlags.load();
  if (esp_now_send(to, (const uint8_t *)packet, len) == ESP_OK) return true;
  sendFailCount++;
  return false;
}

uint32_t sendFails() { return sendFailCount.load(); }
uint32_t rateFails() { return rateFailCount.load(); }

}  // namespace radio
}  // namespace egb
