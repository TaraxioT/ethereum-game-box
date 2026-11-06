// "Which resolver answered, and why": the inspector's account of how the Universal Resolver reached this name's
// records: its own resolver, a linked record (with the name it links to and the record id), or a parent's by wildcard.
import { type Answer, explainAnswer } from "../answer.ts";
import { addressLink, h, nameLink } from "./dom.ts";

const TONE: Record<Answer["kind"], string> = { own: "own", linked: "linked", wildcard: "wild", none: "none" };

export function answerView(answer: Answer): HTMLElement {
  const { headline, why } = explainAnswer(answer);
  const facts: (HTMLElement | null)[] =
    answer.kind === "none"
      ? []
      : [
          h("span", {}, h("em", {}, "resolver "), addressLink(answer.resolver)),
          h("span", {}, h("em", {}, "record "), answer.recordId === 0n ? "default (#0)" : `#${answer.recordId}`),
          answer.kind === "linked" ? h("span", {}, h("em", {}, "linked to "), nameLink(answer.linkedTo)) : null,
          answer.kind === "wildcard" && answer.from ? h("span", {}, h("em", {}, "parent "), nameLink(answer.from)) : null,
        ];
  return h(
    `div.answer.${TONE[answer.kind]}` as "div",
    { "data-focus": "answer" },
    h("div.ah", {}, h("span.eyebrow", {}, "WHICH RESOLVER ANSWERED"), h("b", {}, headline)),
    h("p", {}, why),
    facts.some(Boolean) ? h("div.af", {}, ...facts) : null,
  );
}
