// The PN532 on the station's second I2C bus (Wire1, SDA 35 / SCL 36, 400 kHz, address 0x24), built for latency:
// no fixed delays. A wait for the PN532 sleeps the calling task and wakes it on the IRQ line when pin 37 is wired
// (found out at begin()), otherwise every POLL_US on a timer to read the ready bit: no busy spin, and well under a
// millisecond added to a command. Only the NFC task calls it.
#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <esp_timer.h>

#include "egb/wire.h"

namespace st {

class Pn532 {
 public:
  static constexpr uint8_t ADDRESS = 0x24;
  static constexpr size_t WIRE_BUFFER = 300;  // the ready byte and the longest frame, with room to spare
  static constexpr uint32_t POLL_US = 250;    // between ready-bit reads when IRQ isn't wired

  enum Bus : uint8_t { BUS_IDLE, BUS_FREED, BUS_SCL_STUCK };

  Pn532(TwoWire &wire, uint8_t sda, uint8_t scl, int8_t irq) : wire_(wire), sda_(sda), scl_(scl), irq_(irq) {}

  // Restarts the bus, clocking it clear first: a PN532 cut off mid-transfer by a reset of the S3 (it keeps its power)
  // can hold SDA low, which nine clocks and a STOP free. One holding SCL low can't be freed: only a power cycle.
  Bus restartBus();

  // Wakes the PN532, reads its firmware, configures it (normal mode, IRQ on, one activation try per list so a read
  // with no chip returns at once), and finds out whether its IRQ line is wired.
  bool begin();
  uint32_t firmware() const { return firmware_; }
  bool irqWired() const { return irqWired_; }

  // One look for up to `max` (1 or 2) type A chips, or with `uid` for that chip only. False when the PN532 didn't
  // answer properly; true with n chips (0: none). ISO-DEP chips come back activated (the PN532 sends RATS).
  bool list(egb::Chip *out, uint8_t max, uint8_t &n, const uint8_t *uid = nullptr, uint8_t uidLen = 0,
            uint32_t timeoutMs = 60);

  // InDataExchange with the chip list() activated: the answer's length (status word included), -1 when the PN532
  // didn't answer; `status` is its status byte (low six bits: an error).
  int exchange(const uint8_t *apdu, size_t len, uint8_t *resp, size_t max, uint8_t &status, uint32_t timeoutMs = 2500);

  // Is the ISO-DEP chip list() activated still there? An ISO-DEP R(NAK) block, which a present chip answers (R(ACK),
  // or its last block again) without changing state, so a session of APDUs carries on: ~4.3 ms. Not the PN532's own
  // Diagnose test (libnfc's way): on these HaLos it fails (status 0x13), and sent to a chip nothing has talked to yet
  // it leaves the chip deaf to R(NAK) too, so it read as gone and had to be re-read with a field cycle every check
  // (~48 ms each, measured), which is what once looked like "a fresh HaLo answers no presence check".
  bool present();

  // The RF field off and on again: a chip that an earlier read halted powers up idle and answers the next list. The
  // PN532 takes ~6 ms to switch the field off and ~1.5 ms on, so a cycle is ~21 ms.
  bool resetField(uint32_t offMs = 5, uint32_t onMs = 5);
  bool field(bool on);

  // Raw InCommunicateThru (the PN532 adds the CRC): the chip's answer's length, or -1.
  int thru(const uint8_t *data, size_t len, uint8_t *resp, size_t max, uint8_t &status, uint32_t timeoutMs);

  // Whether list() sends RATS to ISO-DEP chips itself (on by default).
  bool autoRats(bool on);

  uint32_t lastWaitUs() const { return lastWaitUs_; }  // the last command's wait for the PN532 and the chip, not I2C

 private:
  TwoWire &wire_;
  uint8_t sda_, scl_;
  int8_t irq_;
  bool irqWired_ = false;
  bool irqSeen_ = false;  // begin(): every ready seen while probing came with the IRQ line low
  uint32_t firmware_ = 0, lastWaitUs_ = 0;
  esp_timer_handle_t timer_ = nullptr;

  int command(const uint8_t *cmd, size_t n, uint8_t *resp, size_t max, uint32_t timeoutMs);
  bool waitReady(uint32_t timeoutMs);
  bool ready();
  void sleepUs(uint32_t us);
  int readRaw(uint8_t *buf, size_t n);
  void writeRaw(const uint8_t *frame, size_t n);
};

}  // namespace st
