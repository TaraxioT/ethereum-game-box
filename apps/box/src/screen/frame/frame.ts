// The frame page's program (/frame.js): wires the runtime to the page. The frame's own origin is opaque (no
// allow-same-origin), but its URL is the Box's, so the kiosk's origin is the URL's: messages are taken only from the
// parent window at that origin, and posted only to it. The game's screen.js sits next to frame.html.
import { createFrameRuntime } from "./runtime.ts";

const kiosk = new URL(location.href).origin;
const root = document.getElementById("game");

if (root) {
  const runtime = createFrameRuntime({
    root,
    post: (message) => window.parent.postMessage(message, kiosk),
    load: () => import(new URL("screen.js", location.href).href),
  });
  window.addEventListener("message", (event) => {
    if (event.source === window.parent && event.origin === kiosk) runtime.receive(event.data);
  });
  window.addEventListener("error", (event) => runtime.fail(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => runtime.fail(event.reason));
  void runtime.start();
}
