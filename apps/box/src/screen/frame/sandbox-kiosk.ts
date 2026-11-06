// The kiosk's end of server/games/sandbox.test.ts, in a real browser: the real view, gate and channel under the Box's
// real CSP, over a stand-in for the Box's link. It plays each scenario's bundle and reports all the page got through.
// Nothing in the screen imports this.
import type { BoxEvent, BoxState } from "../../core/types.ts";
import type { Layout } from "../shell/layout.ts";
import type { ViewContext } from "../views/view.ts";
import { bundleFrameView } from "./bundle-view.ts";

interface Scenario {
  readonly id: string;
  readonly hash: string;
}

const PLAYERS = [{ name: "NOVA" }, { name: "ORION" }, { name: null }];
const LAYOUT = { orientation: "landscape", width: 1280, height: 800 } as unknown as Layout;
const STATE = {} as BoxState;
const TAP: BoxEvent = { type: "tap", seat: 1, accepted: true, meaning: "play" };
/** Long enough for a page that has left to say anything more it could. */
const SETTLE_MS = 400;
/** Past the view's own ready timeout, so a scenario always ends. */
const GIVE_UP_MS = 12_000;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function play(scenario: Scenario): Promise<unknown> {
  const said: unknown[] = [];
  let finish: (why: string) => void = () => {};
  const ended = new Promise<string>((done) => (finish = done));
  const ctx = {
    layout: LAYOUT,
    link: { state: () => STATE },
  } as unknown as ViewContext;
  const view = bundleFrameView(
    {
      match: () => ({ hash: scenario.hash, title: scenario.id, players: PLAYERS }),
      tap: (event) => (event.type === "tap" ? { seat: event.seat, at: 1234, roll: 77 } : null),
    },
    () => ({
      event(name, data) {
        said.push({ event: name, data });
        if (name === "want-tap") view.update(STATE, TAP);
      },
      station: (seat, text) => said.push({ station: seat, text }),
      buzz: (seat) => said.push({ buzz: seat }),
      end: (why) => finish(why),
    }),
  )(ctx);
  document.body.append(view.el);
  const why = await Promise.race([ended, pause(GIVE_UP_MS).then(() => "gave up")]);
  await pause(SETTLE_MS);
  view.dispose?.();
  view.el.remove();
  return { id: scenario.id, end: why, said };
}

const scenarios = (await (await fetch("/api/scenarios")).json()) as readonly Scenario[];
for (const scenario of scenarios) {
  const report = await play(scenario);
  await fetch("/api/report", { method: "POST", body: JSON.stringify(report) });
}
await fetch("/api/report", { method: "POST", body: JSON.stringify({ done: true }) });
