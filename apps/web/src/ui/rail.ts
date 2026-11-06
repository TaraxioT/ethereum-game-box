// The Story rail: the five numbered steps, the current step's caption, and Back, Next, Reset (and Retry when a
// step's write fails). On a phone it folds to the current step and its keys, pinned to the top.
import type { Story, StoryView } from "../story.ts";
import { outcomes } from "../story-steps.ts";
import { h, key } from "./dom.ts";

export function mountRail(root: HTMLElement, story: Story): (view: StoryView) => void {
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
    const caption = step
      ? h(
          "div.caption",
          {},
          h("b", {}, `${step.title}. `),
          step.caption,
          view.state === "running" ? h("span.wait", {}, "Writing to Sepolia: follow it in the strip below.") : null,
          view.state === "done" && outcomes.has(step.id) ? h("span.wait", { style: "color:var(--fg)" }, outcomes.get(step.id)) : null,
          view.state === "failed" ? h("span.err", {}, view.error ?? "failed") : null,
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
