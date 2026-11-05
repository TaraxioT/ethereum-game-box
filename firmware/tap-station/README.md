# firmware/tap-station

Arduino firmware for the tap stations and the receiver that links them to the Box.

## What goes here

| Folder | Holds |
|---|---|
| `station/` | ESP32-S3 with a PN532 NFC reader, a small OLED and a buzz motor: reads badges, shows prompts, buzzes on a tap |
| `receiver/` | ESP32-C3 on the Pi's USB: bridges the stations (ESP-NOW) to one serial line for `apps/box` |
| `protocol.md` | The JSON lines between the receiver and the Box |

## Rules

Taps must feel instant: no blocking writes on the serial port, and the station answers before it logs.
