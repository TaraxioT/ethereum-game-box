// The core as the outside reaches it while the Box may not host: no tap or screen command gets in (a touch is
// answered with the refused buzz), except the screen's `booted`, so a kiosk that starts while the Box is closed still
// boots. The server's own calls (its timers, its reset) go to the core itself.
import type { Seat } from "@egb/sdk";
import type { Core } from "../core/core.ts";

export function gatedCore(core: Core, hosting: () => boolean, refuse: (seat: Seat) => void): Core {
  return {
    ...core,
    tap(event, source) {
      if (hosting()) core.tap(event, source);
      else if (event.phase === "touch") refuse(event.seat);
    },
    send(command) {
      if (hosting() || command.type === "booted") core.send(command);
    },
  };
}
