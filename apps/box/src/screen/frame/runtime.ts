// The frame side of a built game's screen: what /games/<id>/frame.html runs inside <iframe sandbox="allow-scripts">.
// It loads the game's screen.js, says `ready`, mounts the GameScreen on `init` and hands it each `update`. It posts
// back only `ready` and `error`, and never anything else: the frame only draws.
//
// Platform-free (no window, no parent): frame.ts wires it to the page, and the tests drive it directly.
import { MAX_MESSAGE, type FromFrame, type ToFrame } from "@egb/sdk";
import type { GameScreen } from "@egb/sdk/screen";

/** Errors the frame reports, at most; a screen that throws every frame would otherwise flood the kiosk. */
export const MAX_ERRORS = 10;

export interface FrameRuntimeOptions {
  /** Where the screen draws: the frame page's one element. */
  readonly root: HTMLElement;
  /** Posts to the kiosk. */
  post(message: FromFrame): void;
  /** Imports the game's screen.js. */
  load(): Promise<unknown>;
}

export interface FrameRuntime {
  /** Loads the screen, then posts `ready` (or the error that stopped it). */
  start(): Promise<void>;
  /** A message from the kiosk: anything that isn't a ToFrame is ignored. */
  receive(data: unknown): void;
  /** Reports an error from anywhere in the frame (window `error`, unhandled rejections). */
  fail(error: unknown): void;
}

/** An error as the frame reports it, cut to MAX_MESSAGE. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_MESSAGE);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function isGameScreen(v: unknown): v is GameScreen {
  return isObject(v) && typeof v.mount === "function";
}

/** The kiosk's messages, by shape: the kiosk is trusted, but a stray message must never reach the game's code. */
function toFrame(data: unknown): Extract<ToFrame, { t: "init" | "update" }> | null {
  if (!isObject(data)) return null;
  if (data.t === "init" && isObject(data.manifest) && Array.isArray(data.seats) && typeof data.now === "number") return data as unknown as Extract<ToFrame, { t: "init" }>;
  if (data.t === "update" && isObject(data.event) && typeof data.now === "number") return data as unknown as Extract<ToFrame, { t: "update" }>;
  return null;
}

export function createFrameRuntime(options: FrameRuntimeOptions): FrameRuntime {
  let screen: GameScreen | null = null;
  let mounted: ReturnType<GameScreen["mount"]> | null = null;
  let errors = 0;

  function fail(error: unknown): void {
    if (errors >= MAX_ERRORS) return;
    errors++;
    options.post({ t: "error", message: errorText(error) });
  }

  return {
    async start() {
      try {
        const module = (await options.load()) as { default?: unknown };
        if (!isGameScreen(module.default)) throw new Error("screen.js must default-export a GameScreen { mount }");
        screen = module.default;
      } catch (error) {
        return fail(error);
      }
      options.post({ t: "ready" });
    },
    receive(data) {
      const message = toFrame(data);
      if (!message || !screen) return;
      try {
        if (message.t === "init") {
          // A second init (the kiosk's view came back) starts the drawing over.
          options.root.replaceChildren();
          mounted = screen.mount(options.root, message);
        } else {
          mounted?.update(message);
        }
      } catch (error) {
        fail(error);
      }
    },
    fail,
  };
}
