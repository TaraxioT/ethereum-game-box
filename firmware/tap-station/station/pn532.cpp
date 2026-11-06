#include "pn532.h"

#include <driver/gpio.h>
#include <esp_timer.h>

#include "pn532_frame.h"

namespace st {

static TaskHandle_t waiter = nullptr;  // the task in waitReady(): the IRQ edge or the poll timer wakes it

static void IRAM_ATTR onIrq() {
  BaseType_t woke = pdFALSE;
  if (waiter) vTaskNotifyGiveFromISR(waiter, &woke);
  if (woke) portYIELD_FROM_ISR();
}

static void onTimer(void *) {
  if (waiter) xTaskNotifyGive(waiter);
}

constexpr size_t SHORT_READ = 16;  // fits a status word, a presence check, a config answer: most answers

Pn532::Bus Pn532::restartBus() {
  wire_.end();
  pinMode(sda_, INPUT_PULLUP);
  pinMode(scl_, INPUT_PULLUP);
  delayMicroseconds(20);
  bool sclLow = !digitalRead(scl_), sdaLow = !digitalRead(sda_);
  // Clock SCL until SDA is let go (nine clocks finish any byte), then a STOP: SDA rising while SCL is high.
  pinMode(scl_, OUTPUT_OPEN_DRAIN);
  digitalWrite(scl_, HIGH);
  for (int i = 0; i < 18 && !digitalRead(sda_); i++) {
    digitalWrite(scl_, LOW);
    delayMicroseconds(5);
    digitalWrite(scl_, HIGH);
    delayMicroseconds(5);
  }
  pinMode(sda_, OUTPUT_OPEN_DRAIN);
  digitalWrite(sda_, LOW);
  delayMicroseconds(5);
  digitalWrite(sda_, HIGH);
  delayMicroseconds(5);
  pinMode(sda_, INPUT_PULLUP);
  pinMode(scl_, INPUT_PULLUP);
  wire_.setBufferSize(WIRE_BUFFER);
  wire_.begin(sda_, scl_, 400000);
  return sclLow ? BUS_SCL_STUCK : sdaLow ? BUS_FREED : BUS_IDLE;
}

bool Pn532::begin() {
  static const uint8_t GET_FIRMWARE[] = {0x02};
  static const uint8_t SAM_CONFIG[] = {0x14, 0x01, 0x00, 0x01};  // normal mode, no timeout, IRQ on
  // RFConfiguration MaxRetries: ATR 0xFF, PSL 0x01, passive activation 0x00 (one try, so a list with no chip returns
  // at once instead of the PN532 searching for ever).
  static const uint8_t ONE_TRY[] = {0x32, 0x05, 0xFF, 0x01, 0x00};
  if (!timer_) {
    esp_timer_create_args_t args = {};
    args.callback = onTimer;
    args.name = "pn532";
    esp_timer_create(&args, &timer_);
    if (irq_ >= 0) {
      pinMode(irq_, INPUT_PULLUP);
      attachInterrupt(irq_, onIrq, FALLING);
    }
  }
  irqWired_ = false;
  wire_.beginTransmission(ADDRESS);  // wakes a sleeping PN532 (it may not ack this one)
  wire_.endTransmission();
  delay(2);
  uint8_t r[8];
  bool idleHigh = irq_ >= 0 && digitalRead(irq_);
  if (command(GET_FIRMWARE, sizeof GET_FIRMWARE, r, sizeof r, 100) < 4) return false;
  firmware_ = (uint32_t)r[0] << 24 | (uint32_t)r[1] << 16 | (uint32_t)r[2] << 8 | r[3];
  // The PN532 pulls IRQ low while it has an answer: if the line sat high and went low for that one, it's wired.
  if (command(SAM_CONFIG, sizeof SAM_CONFIG, r, sizeof r, 100) < 0) return false;
  irqWired_ = idleHigh && irqSeen_;
  return command(ONE_TRY, sizeof ONE_TRY, r, sizeof r, 100) >= 0;
}

bool Pn532::autoRats(bool on) {
  uint8_t cmd[] = {0x12, (uint8_t)(on ? 0x14 : 0x04)};  // SetParameters: fAutomaticATR_RES, fAutomaticRATS
  uint8_t r[2];
  return command(cmd, sizeof cmd, r, sizeof r, 50) >= 0;
}

bool Pn532::list(egb::Chip *out, uint8_t max, uint8_t &n, const uint8_t *uid, uint8_t uidLen, uint32_t timeoutMs) {
  uint8_t cmd[3 + egb::CHIP_UID_MAX] = {0x4A, max, 0x00};  // InListPassiveTarget, 106 kbps type A
  if (uid) memcpy(cmd + 3, uid, uidLen);
  uint8_t r[1 + 2 * (6 + egb::CHIP_UID_MAX + 1 + egb::CHIP_ATS_MAX + 8)];
  n = 0;
  int got = command(cmd, 3 + (uid ? uidLen : 0), r, sizeof r, timeoutMs);
  if (got < 1) return false;
  n = frame::targets(r, (size_t)got, out, max);
  return true;
}

int Pn532::exchange(const uint8_t *apdu, size_t len, uint8_t *resp, size_t max, uint8_t &status, uint32_t timeoutMs) {
  uint8_t cmd[2 + egb::APDU_MAX];
  if (len > egb::APDU_MAX) return -1;
  cmd[0] = 0x40;  // InDataExchange
  cmd[1] = 0x01;  // the first chip
  memcpy(cmd + 2, apdu, len);
  static uint8_t r[1 + frame::MAX_DATA];  // only the NFC task calls this
  int got = command(cmd, 2 + len, r, sizeof r, timeoutMs);
  if (got < 1) return -1;
  status = r[0];
  size_t n = (size_t)got - 1 < max ? (size_t)got - 1 : max;
  memcpy(resp, r + 1, n);
  return status & 0x3F ? 0 : (int)n;
}

int Pn532::thru(const uint8_t *data, size_t len, uint8_t *resp, size_t max, uint8_t &status, uint32_t timeoutMs) {
  uint8_t cmd[1 + 64];
  if (len > 64) return -1;
  cmd[0] = 0x42;  // InCommunicateThru
  memcpy(cmd + 1, data, len);
  uint8_t r[1 + 64];
  int got = command(cmd, 1 + len, r, sizeof r, timeoutMs);
  if (got < 1) return -1;
  status = r[0];
  size_t n = (size_t)got - 1 < max ? (size_t)got - 1 : max;
  memcpy(resp, r + 1, n);
  return (int)n;
}

bool Pn532::present() {
  static const uint8_t R_NAK = 0xB2;  // ISO-DEP R(NAK), block 0
  uint8_t r[16], status;
  int n = thru(&R_NAK, 1, r, sizeof r, status, 100);
  return n >= 1 && (status & 0x3F) == 0;
}

bool Pn532::field(bool on) {
  uint8_t cmd[] = {0x32, 0x01, (uint8_t)on}, r[2];  // RFConfiguration, RF field
  return command(cmd, sizeof cmd, r, sizeof r, 50) >= 0;
}

bool Pn532::resetField(uint32_t offMs, uint32_t onMs) {
  if (!field(false)) return false;
  vTaskDelay(pdMS_TO_TICKS(offMs));
  if (!field(true)) return false;
  vTaskDelay(pdMS_TO_TICKS(onMs));
  return true;
}

int Pn532::command(const uint8_t *cmd, size_t n, uint8_t *resp, size_t max, uint32_t timeoutMs) {
  static uint8_t buf[8 + 255 + 2];  // only the NFC task talks to the PN532
  size_t len = frame::build(cmd, n, buf);
  if (!len) return -1;
  writeRaw(buf, len);
  if (wire_.endTransmission() != 0) return -1;
  // The ACK frame, then the answer; each wait sleeps until the PN532 is ready.
  irqSeen_ = true;
  uint32_t w0 = micros();
  if (!waitReady(timeoutMs)) return -1;
  lastWaitUs_ = micros() - w0;
  if (readRaw(buf, 7) < 7 || !frame::isAck(buf, 7)) return -1;
  w0 = micros();
  if (!waitReady(timeoutMs)) {
    static const uint8_t ABORT[] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};  // an ACK from the host drops the command
    writeRaw(ABORT, sizeof ABORT);
    wire_.endTransmission();
    return -1;  // otherwise its late answer would be read as the next command's
  }
  lastWaitUs_ += micros() - w0;
  // Reading the longest frame every time costs ~6 ms of I2C, and most answers are short: read 16 bytes, and only a
  // longer answer is asked for again (a NACK makes the PN532 send it again) and read to its length.
  size_t want = max + 10 < sizeof buf ? max + 10 : sizeof buf;
  int got = readRaw(buf, want < SHORT_READ ? want : SHORT_READ);
  size_t full = frame::fullLength(buf, (size_t)got);
  if (full > want) full = want;
  if (full > (size_t)got) {
    static const uint8_t NACK[] = {0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00};
    writeRaw(NACK, sizeof NACK);
    wire_.endTransmission();
    if (!waitReady(50)) return -1;
    got = readRaw(buf, full);
  }
  return got < 0 ? -1 : frame::parse(buf, (size_t)got, cmd[0], resp, max);
}

bool Pn532::ready() {
  bool r = wire_.requestFrom(ADDRESS, (size_t)1) == 1 && (wire_.read() & 0x01);
  if (r && irq_ >= 0 && digitalRead(irq_)) irqSeen_ = false;  // ready, and the line didn't say so
  return r;
}

bool Pn532::waitReady(uint32_t timeoutMs) {
  uint32_t t0 = micros(), limit = timeoutMs * 1000;
  waiter = xTaskGetCurrentTaskHandle();
  bool ok = false;
  for (;;) {
    if (irqWired_ ? !gpio_get_level((gpio_num_t)irq_) : ready()) {
      ok = true;
      break;
    }
    uint32_t spent = micros() - t0;
    if (spent >= limit) break;
    if (irqWired_) ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS((limit - spent) / 1000 + 1));
    else sleepUs(POLL_US);
  }
  waiter = nullptr;
  return ok;
}

void Pn532::sleepUs(uint32_t us) {
  ulTaskNotifyTake(pdTRUE, 0);  // drop a stale wake-up, so this one sleeps
  esp_timer_start_once(timer_, us);
  ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5));
  esp_timer_stop(timer_);  // in case something else woke the task first
}

int Pn532::readRaw(uint8_t *buf, size_t n) {
  int got = wire_.requestFrom(ADDRESS, n);
  for (int k = 0; k < got; k++) buf[k] = (uint8_t)wire_.read();
  return got;
}

void Pn532::writeRaw(const uint8_t *frame, size_t n) {
  wire_.beginTransmission(ADDRESS);
  wire_.write(frame, n);
}

}  // namespace st
