// The station's own USB serial, for bring-up and screenshots (protocol.md, "The station's own serial port"):
//   press           the same as BOOT: toggles the receiver's LED (`press id=… acked rtt_us=… tries=…` follows)
//   buzz [ms]       the motor
//   stats           stack high-water marks and counters
//   frame           the OLED as `frame 72 40 <hex>` (tools/frame.py)
//   bench <what> [n]  timing runs on the chip on the reader (bench.cpp)
// It prints `tag uid=… read_us=…` and `tag gone` as chips come and go.
#pragma once

#include <EgbLink.h>

namespace st {
namespace cli {

void line(const egb::Line &l);  // one command line from the port

}  // namespace cli
}  // namespace st
