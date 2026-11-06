// The Story rail: the seven numbered steps, the current step's caption, and Back, Next, Reset (and Retry when a
// step's write fails). On a phone it folds to the current step and its keys, pinned to the top.
import { fullName } from "@egb/shared/names";

import { state } from "../app.ts";
import { client } from "../chain.ts";
import { readAddress } from "../ens.ts";
import { locate } from "../registry.ts";
import type { Story, StoryView } from "../story.ts";
import { outcome } from "../story-steps.ts";
import { h, key } from "./dom.ts";
import { countdownEl } from "./live.ts";

/** The story's pop-up, counting down in the rail while the rest of the story runs. */
function popupLine(): HTMLElement | null {
  const label = state.story.popup;
  if (!label) return null;
  const name = fullName(label);
  const line = h("span.wait", {}, `${name}: `, h("b", {}, "…"));
  void locate(client, name).then((where) => {
    const count = countdownEl(where.expiry);
    line.replaceChildren(`${name}: `, count);
    count.addEventListener("expired", () => {
      // The chain's answer, a block after the expiry.
      const check = async () => {
        const address = await readAddress(client, name);
        if (address === null) line.replaceChildren(`${name}: `, h("b", { style: "color:#ff8a94" }, "expired: no longer resolves"));
        else setTimeout(check, 6_000);
      };
      setTimeout(check, 2_000);
    });
  });
  return line;
}

export function mountRail(root: HTMLElement, story: Story): (view: StoryView) => void {
  let popup: HTMLElement | null = null;
  let popupFor: string | null = null;
  return (view: StoryView) => {
    const step = story.steps[view.index];
    const list = h(
      "ol",
      {},
      ...story.steps.map((s, i) => {
        const cls = i === view.index ? `li.on.${view.state}` : i < view.index ? "li.done" : "li";
        return h(cls as "li", { "data-n": i + 1 }, s.title, h("em", {}, s.brief));
      }),
    );
    if (state.story.popup !== popupFor) {
      popupFor = state.story.popup;
      popup = popupLine();
    }
    const caption = step
      ? h(
          "div.caption",
          {},
          h("b", {}, `${step.title}. `),
          step.caption,
          view.state === "running" ? h("span.wait", {}, "Writing to Sepolia: follow it in the strip below.") : null,
          view.state === "done" && outcome.text && step.id === "title" ? h("span.wait", { style: "color:var(--fg)" }, outcome.text) : null,
          view.state === "failed" ? h("span.err", {}, view.error ?? "failed") : null,
          popup,
        )
      : null;
    const keys = h(
      "div.keys",
      {},
      key("Back", () => void story.back()),
      view.state === "failed" ? key("Retry", () => void story.retry(), true) : key("Next", () => void story.next(), true),
      key("Reset", () => void story.reset()),
    );
    const [back, next] = keys.querySelectorAll("button");
    back!.disabled = !story.canBack;
    if (view.state !== "failed") next!.disabled = !story.canNext;
    root.replaceChildren(
      h("h4", {}, "THE STORY · 2 MIN"),
      h("div.now", {}, h("span", {}, `${view.index + 1} / ${story.steps.length}`), step?.title ?? ""),
      list,
      ...(caption ? [caption] : []),
      keys,
    );
  };
}
