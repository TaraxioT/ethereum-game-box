// /bundle-host.js: the first script in a store bundle's page, added as the Box serves it. A classic script, so it runs
// before anything of the game's. As in frame.ts, the frame's origin is opaque but its URL is the Box's: messages are
// taken only from the parent window at that origin, and posted only to it.
import { createBundleRuntime } from "./bundle-runtime.ts";

const kiosk = new URL(location.href).origin;
const runtime = createBundleRuntime({ post: (message) => window.parent.postMessage(message, kiosk), name: window.name });

// A plain property: against a fixed one, a game's own `const egb = window.egb` would be a SyntaxError.
Object.assign(window, { egb: runtime.egb });
window.addEventListener("message", (event) => {
  if (event.source === window.parent && event.origin === kiosk) runtime.receive(event.data);
});
window.addEventListener("error", (event) => runtime.fail(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => runtime.fail(event.reason));
window.addEventListener("load", () => runtime.ready());
