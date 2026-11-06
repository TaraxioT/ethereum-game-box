# apps/verifier/container

`@egb/verifier-container`: the verifier's container. It runs the agent that judges one store match, and proposes who
gets paid how much. It holds no secrets and can't reach the internet. The Worker checks the proposal, and only the
Worker signs. [`plan/game-store.md`](../../../plan/game-store.md) says why.

It's a small TypeScript program, run by Node 26 with no build step and no runtime dependencies.

## Routes

It listens on port 8080. The types are `@egb/shared/store`.

| Route | Takes | Answers |
|---|---|---|
| `GET /health` | | `200 { ok: true }` |
| `POST /run` | `AgentRunRequest` | `200 { verdict: AgentVerdict }`, or `500 { error }` if the run failed |

`cannot_judge` is a verdict, so it comes back as a `200`, and the Worker treats it as a failure. A body that isn't a job
gets a `400`, or a `413` over 2 MiB. A second `POST /run` gets a `409`.

**One job, then exit.** A container takes one `POST /run`, whatever comes of it, and exits once it has answered or the
caller has gone. A retry needs a fresh container.

## The agent

Our own small loop in `src/agent.ts`, on the OpenAI chat format, against `ZG_PROXY_URL` (default
`http://zg.internal/v1/chat/completions`). It sends no key and no `model`: the Worker's proxy adds those.

It has two tools, `shell` and `submit_verdict`, and it gets the instructions and the log as two files in a fresh
folder. The run ends only with `submit_verdict`, alone in its reply, as a `split` (payouts as decimal strings) or as
`cannot_judge`. Anything else fails the run: a reply with no tool call, a malformed call, an unknown tool, a malformed
verdict, a limit passed, or a model error. The model isn't asked to try again, because the Worker's retry covers that.

The container checks a verdict's shape only. Whether the payouts match the players and add up to the pot is the Worker's
check.

| Limit | Value | Passing it |
|---|---|---|
| Turns | 16 | fails the run |
| Wall time | 5 minutes | fails the run |
| One model reply | 60 s, 2,048 tokens | fails the run |
| Tokens across the run | 200,000, counting each turn's whole prompt | fails the run |
| One shell call | 20 s, 16 KiB of output | stops the call and tells the model |

Tokens are counted from each reply's usage, and each prompt is also estimated before it goes out, at three bytes a token,
because one reply can make any number of shell calls. A prompt that would pass the limit isn't sent.

The Worker has to wait longer than the wall time before it gives up on a run.

## The sandbox

Three users, and the image starts as root only to leave it.

- **`judge` (10000)** runs tini and the server. It keeps three capabilities, `setuid`, `setgid` and `setpcap`, which
  `setpriv` needs to start the shell, and `reap.ts` to change user. That's less than root, but it isn't nothing: a
  process with `setuid` could become root. What keeps the agent away from it is that it's a different user.
- **`agent` (10001)** runs the shell, through `setpriv`. It has no capabilities in any set, `no_new_privs`, and an
  environment of just `PATH`, `HOME` and `LANG`. It can't read the server's memory, environment or files, and it
  can't change the two files it was given. `prlimit` caps its processes, open files and file sizes.
- **`reaper` (10002)** runs only `src/reap.ts`, which ends the agent's processes.

Nothing the agent starts outlives its call. As each call ends, `reap.ts` makes one `kill -1` with the agent's effective
ID, which ends every process the agent owns at once, even one that left the shell's process group. The agent can't kill
or freeze it first, because the kernel checks a target's real and saved IDs, and those are `reaper`'s. It gets no
environment either, so it can't show the agent the server's.

A call ends only after that has finished, or a late kill would hit the next call. If it fails, the call fails, and if it
never finishes, the run's wall time still ends the run. tini reaps what's left, which Node wouldn't, and zombies would
otherwise use up the shell's process limit.

The server checks all this as it starts, and exits rather than serve if it's root, or the switch of user or the cleanup
fails.

## What the Worker must do

The shell shares the server's network, so **it can reach `zg.internal` too**, and Cloudflare's outbound handler can't
tell which process is calling. The limits above bind the loop and not a shell that calls the proxy itself, so a tricked
agent could spend the team's 0G balance unless the proxy stops it. For each container (`ctx.containerId`), the proxy
must:

- accept only `POST /v1/chat/completions`;
- set `max_tokens`, the model, `X-0G-Provider-Trust-Mode: private` and `verify_tee: true` itself, whatever it's sent;
- cap the turns and tokens, at no more than the limits above;
- refuse a request too large to fit those limits before it reaches 0G, as a shell's request is checked by nothing else.

It must also answer anything but `200` for a turn it can't prove: that's what fails the run here.

## Tests

- `pnpm test`: the loop, the shell and the server, with real bash and a fake model server.
- `pnpm test:docker`: builds the real image and runs one job on an internal Docker network, with the fake model as
  `zg.internal`. The agent's shell then tries to break out from inside: it reads the environment, the server's memory
  and files, and the internet, it runs a fork bomb, and it leaves processes that watch, kill or freeze whatever the
  server starts next. Controls show that the probes can succeed and the checks can fail.
  `EGB_DOCKER_PLATFORM=linux/amd64` builds for what Cloudflare runs.

An internal Docker network stands in for `enableInternet = false`. It doesn't prove Cloudflare: the plan's own check,
from a shell in a live container, still has to run there. That run will also show whether Cloudflare grants the three
capabilities. If it doesn't, the container won't start, and every run refunds.
