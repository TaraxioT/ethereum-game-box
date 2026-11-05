// The router: mounts the view the Box's phase calls for and moves between views by derez and rez: the old view
// folds into a line of light and goes out, the new one opens out of a line. State changes reach the mounted view; the new view starts from the current
// state, so nothing that happened during a move is lost.
import type { BoxEvent, BoxState } from "../link/types.ts";
import type { Pose, View, ViewContext, ViewFactory } from "../views/view.ts";
import { derez, rez } from "./rez.ts";

export interface Route {
  /** A key that changes when a different view is needed (phase, plus the game while playing). */
  readonly key: string;
  readonly pose: Pose;
  readonly view: ViewFactory | null;
}

export type Routes = (state: BoxState) => Route;

export interface Router {
  update(state: BoxState, event: BoxEvent): void;
  dispose(): void;
}

export function createRouter(ctx: ViewContext, host: HTMLElement, routes: Routes, onPose: (pose: Pose) => void): Router {
  let key = "";
  let view: View | null = null;
  let disposed = false;

  async function swap(route: Route): Promise<void> {
    const old = view;
    view = null;
    if (old) {
      // Its timers and listeners stop at once; only its picture derezzes.
      old.dispose?.();
      await derez(old.el);
      old.el.remove();
    }
    // A newer move, or a rebuilt stage, has taken over while this one waited.
    if (disposed || route.key !== key) return;
    onPose(route.pose);
    if (!route.view) return;
    const next = route.view(ctx);
    view = next;
    next.el.classList.add("view");
    host.append(next.el);
    next.update(ctx.link.state(), { type: "init" });
    void rez(next.el);
  }

  return {
    update(state, event) {
      const route = routes(state);
      if (route.key !== key) {
        key = route.key;
        void swap(route);
        return;
      }
      view?.update(state, event);
    },
    dispose() {
      disposed = true;
      view?.dispose?.();
      view?.el.remove();
      view = null;
    },
  };
}
