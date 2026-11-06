// The game builder's view, mounted while the Box is in its `build` phase: the Designer, or the Build screen while a
// build runs and once it has ended, moving between them in depth as the router moves between views. It holds the
// builder's event stream: `hello` says where things stand (and comes again after a reconnect), `designer` events
// redraw the Designer, `forge` events drive the Build screen, and a newly queued build takes the screen.
//
// The Designer sits on a page round the sunken core (pose `page`); the Build screen on the whole lit board (pose
// `home`), where its packets run. While the player works, and while a build streams in, it tells the Box someone is
// still here (`build`), so the builder only times out back to Home when left alone.
import type { DesignerState, ForgeEvent, ForgeJob } from "../../builder/types.ts";
import { BUILDER, type BuilderStatus, type HelloEvent } from "../../server/builder-wire.ts";
import { el, play } from "../shell/dom.ts";
import { createBuildScreen, type BuildScreen } from "./build.ts";
import { getJson, openBuilderStream, postJson } from "./builder-link.ts";
import { createDesignerScreen, type DesignerScreen } from "./designer.ts";
import type { View, ViewContext } from "./view.ts";
import "./builder.css";

/** `build` (still here) goes to the Box at most this often. */
const STAY_MS = 20_000;

export function builderView(ctx: ViewContext): View {
  const { link, machine } = ctx;
  const root = el("div", "builder");
  let status: BuilderStatus | null = null;
  let designer: DesignerScreen | null = null;
  let build: BuildScreen | null = null;
  let lastDesign: DesignerState | null = null;
  let stayedAt = 0;
  /** This visit has a design: the first hello opens or resumes one; later ones only redraw it. */
  let opened = false;

  function stay(): void {
    const now = Date.now();
    if (now - stayedAt < STAY_MS) return;
    stayedAt = now;
    link.send({ type: "build" });
  }

  /** The old screen sinks, the new one rises toward the glass (the router's move). */
  function swap(next: HTMLElement, pose: "page" | "home"): void {
    const old = root.firstElementChild as HTMLElement | null;
    machine.pose(pose);
    root.append(next);
    void play(next, [{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    if (old) void play(old, [{ opacity: 1 }, { opacity: 0, transform: "scale(0.96)" }], { duration: 220, fill: "forwards" }).then(() => old.remove());
  }

  function showDesigner(): void {
    if (designer || !status) return;
    build?.dispose();
    build = null;
    designer = createDesignerScreen(ctx, status, { stay });
    swap(designer.el, "page");
    if (lastDesign) designer.update(lastDesign);
  }

  function showBuild(job: ForgeJob): void {
    if (build?.job === job.id) return;
    designer?.dispose();
    designer = null;
    build?.dispose();
    build = createBuildScreen(ctx, job, {
      stay,
      toDesigner: () => {
        stay();
        showDesigner();
      },
    });
    swap(build.el, "home");
  }

  /** The design on the Box was built into a game already: the newest build is of exactly this brief, and it worked. */
  async function built(state: DesignerState): Promise<boolean> {
    const [newest] = await getJson<ForgeJob[]>(BUILDER.jobs).catch((): ForgeJob[] => []);
    return newest?.status === "done" && JSON.stringify(newest.brief) === JSON.stringify(state.brief);
  }

  async function openDesign(state: DesignerState | null): Promise<void> {
    // A design is picked up where it was left (a reload, a turned screen); one already built, or none, starts afresh.
    const fresh = !state || (state.step === "confirm" && !state.locked && (await built(state)));
    const next = fresh ? await postJson<DesignerState>(BUILDER.start).catch(() => state) : state;
    if (next) onDesign(next);
  }

  function onDesign(state: DesignerState): void {
    lastDesign = state;
    designer?.update(state);
  }

  function onHello(hello: HelloEvent): void {
    status = hello.status;
    designer?.setStatus(hello.status);
    if (hello.job) {
      if (build?.job === hello.job.id) build.reset();
      else showBuild(hello.job);
    } else if (!build) showDesigner();
    if (!opened) {
      opened = true;
      void openDesign(hello.designer);
    } else if (hello.designer) onDesign(hello.designer);
  }

  function onForge(event: ForgeEvent): void {
    // A new build takes the screen: the Designer's BUILD (or its spoken "yes") just started it, from the design on
    // screen, so the job is known here at once and none of its events can pass the screen by.
    if (event.type === "status" && event.status === "queued" && build?.job !== event.job && lastDesign && status) {
      showBuild({ id: event.job, brief: lastDesign.brief, provider: status.provider, status: "queued", createdAt: event.at, game: null, error: null });
    }
    build?.apply(event);
  }

  const stream = openBuilderStream((event, data) => {
    if (event === "hello") onHello(data as HelloEvent);
    else if (event === "designer") onDesign(data as DesignerState);
    else onForge(data as ForgeEvent);
  });

  return {
    el: root,
    update() {
      // The Box's own state changes nothing here: the builder's stream does.
    },
    dispose() {
      stream.close();
      designer?.dispose();
      build?.dispose();
    },
  };
}
