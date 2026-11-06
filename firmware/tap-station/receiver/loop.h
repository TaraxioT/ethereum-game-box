// What the receiver's loop task owns, shared by its modules (only that task touches any of it).
#pragma once

#include <EgbLink.h>

#include "commands.h"
#include "inbox.h"

namespace rcv {

constexpr size_t SLOTS = 16;  // per station: an NFC request, a screen, a stats request, and buzzes
constexpr size_t OUT_MAX = 1024;

extern egb::Stations stations;
extern egb::Pool<SLOTS> slots;
extern egb::Json json;

// Writes the line just built in `json` (`n` = its length; 0 = it overflowed and is dropped).
void emit(size_t n);

// stations.cpp: a packet from a station, a change in its link, the receiver's own press.
void onPacket(const Msg &m);
void checkLinks(uint32_t nowMs);
void onPress(const egb::press::Outcome &o);

// requests.cpp: a command from the Pi, and the requests it started.
void onCommand(const Command &c, const char *line);
void pollSlots(uint32_t nowMs);

// Where the receiver's presses go: the first linked station, or broadcast until there is one (read by the press task).
void pressPeer(uint8_t mac[6]);
void setPressPeer(const uint8_t mac[6]);

}  // namespace rcv
