// Tap Three's screen: the score as text. Its root is typed by the one property it uses rather than as HTMLElement,
// so this fixture also compiles under the server's tsconfig, which has no DOM; a GameScreen accepts it all the same.
import type { ToFrame } from "@egb/sdk";
import type { TapThreeState } from "./rules.ts";

type Init = Extract<ToFrame, { t: "init" }>;
type Update = Extract<ToFrame, { t: "update" }>;

const score = (state: unknown) => {
  const s = state as TapThreeState;
  return `${s.taps[0]} : ${s.taps[1]}`;
};

const screen = {
  mount(root: { textContent: string | null }, init: Init) {
    root.textContent = score(init.state);
    return {
      update(message: Update) {
        root.textContent = score(message.state);
      },
    };
  },
};

export default screen;
