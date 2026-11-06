// The station's stats: each task's lowest free stack since boot, and the counters (`stats` here and over the link).
#pragma once

#include <EgbLink.h>

namespace st {

egb::StatsRes stats();  // call from the loop task (its own stack is measured from inside it)

}  // namespace st
