// EgbLink: the link between the tap stations (ESP32-S3) and the Pi's receiver (ESP32-C3). Both sketches include this
// first; the plain C++ parts under egb/ are also built by the host tests.
#pragma once

#include "egb/config.h"
#include "egb/hex.h"
#include "egb/json.h"
#include "egb/lines.h"
#include "egb/press.h"
#include "egb/radio.h"
#include "egb/resend.h"
#include "egb/serial.h"
#include "egb/stations.h"
#include "egb/wire.h"
