// Runs in a plain Node container on the test network, with the alias `zg.internal`: it's the model the verifier's
// container reaches, and it plays the Worker's part too, sending the job. It prints what came back as JSON.
import { setTimeout as delay } from "node:timers/promises";

import { reply, type Step, startFakeModel, toolCall, verdictCall } from "../fake-model.ts";
import { BURST, JOB, type Probe, PROBES, VERDICT, VERIFIER_HOST, VERIFIER_PORT } from "./probes.ts";

const VERIFIER = `http://${VERIFIER_HOST}:${VERIFIER_PORT}`;
const MODEL_PORT = 80;

/** One reply a probe, with the burst behind the last, which keeps the run inside its turn limit. */
const TURNS = PROBES.map((probe, index) => (index === PROBES.length - 1 ? [probe, ...BURST] : [probe]));

/** Shell calls with a real usage figure, or the probes' long outputs would count against the token limit. */
const probeCalls = (probes: readonly Probe[]): Step =>
  reply(
    {
      role: "assistant",
      content: null,
      tool_calls: probes.map(({ command }, index) => toolCall("shell", { command }, `call-${index}`)),
    },
    { total_tokens: 100 },
  );

async function waitForHealth(): Promise<void> {
  for (let tries = 0; tries < 60; tries++) {
    const ok = await fetch(`${VERIFIER}/health`).then((response) => response.ok, () => false);
    if (ok) return;
    await delay(500);
  }
  throw new Error("the verifier never became healthy");
}

const model = await startFakeModel((turn) => {
  const probes = TURNS[turn];
  return probes ? probeCalls(probes) : verdictCall(VERDICT);
}, MODEL_PORT);

await waitForHealth();
const response = await fetch(`${VERIFIER}/run`, { method: "POST", body: JSON.stringify(JOB) });
const body: unknown = await response.json();

const messages = model.requests.at(-1)?.body.messages ?? [];
console.log(
  JSON.stringify({
    status: response.status,
    body,
    results: messages.filter((message) => message.role === "tool").map((message) => message.content),
    turns: model.requests.length,
    authorized: model.requests.filter(({ headers }) => headers.authorization !== undefined).length,
  }),
);
await model.close();
