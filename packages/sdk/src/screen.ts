// A built game's screen module, as the frame loads it: `screen.ts` default-exports a GameScreen. Browser only, so it
// is its own entry (`@egb/sdk/screen`), apart from the DOM-free index.
import type { ToFrame } from "./frame.ts";

export interface GameScreen {
  mount(root: HTMLElement, init: Extract<ToFrame, { t: "init" }>): {
    update(message: Extract<ToFrame, { t: "update" }>): void;
  };
}
