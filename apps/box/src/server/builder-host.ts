// The game builder on the Box server: the Forge (builds, each in its own child process) and the Designer (one design
// at a time), sharing one edit lock, with every Designer change and every ForgeEvent fanned out to the builder's
// screens over one event stream. A confirmed design goes straight to the Forge on this Box's provider.
import { join } from "node:path";
import { createDesigner, type DesignerService } from "../builder/designer/service.ts";
import { createEditLock } from "../builder/designer/lock.ts";
import { createForge, type ForgeService } from "../builder/forge/service.ts";
import type { Env } from "../builder/llm/claude-env.ts";
import { createModelClient } from "../builder/llm/model.ts";
import { isFinished, type ForgeJob, type ForgeProvider } from "../builder/types.ts";
import { createVoice } from "../builder/voice/select.ts";
import { createBuilderStream, type BuilderStream } from "./builder-stream.ts";
import type { BuilderStatus } from "./builder-wire.ts";
import { HttpError } from "./http.ts";

export interface BuilderOptions {
  /** $EGB_DATA: the Forge's jobs, work and installed games, and the voice's clips and budgets. */
  readonly dataDir: string;
  /** The Box's environment: EGB_FORGE_PROVIDER, the model, the voice and the Forge's limits (builder/README.md). */
  readonly env: Env;
  /** Folders whose games may be templates: the team games' folder. */
  readonly gameRoots: readonly string[];
  /** A game was installed or removed: the library rescans. */
  readonly onLibraryChange: () => void;
  readonly log: (text: string) => void;
  /** The sim's pace: 1 is the recorded pace (the default), 0 at once (tests). */
  readonly simSpeed?: number;
}

export interface Builder {
  readonly designer: DesignerService;
  readonly forge: ForgeService;
  /** Who builds on this Box: EGB_FORGE_PROVIDER. */
  readonly provider: ForgeProvider;
  readonly stream: BuilderStream;
  status(): BuilderStatus;
  /** A build is queued or running. */
  building(): boolean;
  /** The build a screen should be watching: the one running, else the next queued; null when none is. */
  activeJob(): ForgeJob | null;
  /** The build the Designer's last confirm started. */
  lastConfirmed(): ForgeJob | null;
  /** Stops the running build (10 s at most), the Designer and every stream. */
  stop(): Promise<void>;
}

const PROVIDERS: readonly ForgeProvider[] = ["claude", "sim"];

/** EGB_FORGE_PROVIDER: `claude` (the default) or `sim`. Anything else stops the start: a typo must not build blind. */
export function forgeProvider(env: Env): ForgeProvider {
  const value = env.EGB_FORGE_PROVIDER?.trim() || "claude";
  if (!PROVIDERS.includes(value as ForgeProvider)) throw new Error(`EGB_FORGE_PROVIDER must be claude or sim, not "${value}"`);
  return value as ForgeProvider;
}

export function startBuilder(options: BuilderOptions): Builder {
  const { env, log } = options;
  const provider = forgeProvider(env);
  const lock = createEditLock();
  const stream = createBuilderStream();
  const forge = createForge({
    dataDir: options.dataDir,
    gameRoots: options.gameRoots,
    env,
    lock,
    log,
    onLibraryChange: options.onLibraryChange,
    ...(options.simSpeed === undefined ? {} : { simSpeed: options.simSpeed }),
  });
  const designer = createDesigner({
    shelf: { templates: () => forge.shelf() },
    lock,
    model: createModelClient(env),
    voice: createVoice(env, { dir: join(options.dataDir, "voice") }),
  });
  let confirmed: ForgeJob | null = null;

  // A confirmed design is built at once. The Forge takes the lock inside submit(), before confirm() returns, so a
  // second tap on Build finds the design locked. A provider that can't build here refuses before anything is queued.
  designer.onConfirm((brief) => {
    const ready = forge.ready(provider);
    if (!ready.ok) throw new HttpError(409, ready.reason ?? "This Box can't build games right now.");
    confirmed = forge.submit(brief, provider);
    log(`[builder] building "${brief.title ?? brief.template}" (${confirmed.id}, ${provider})`);
  });
  const stopDesigner = designer.onChange((state) => stream.send("designer", state));
  const stopForge = forge.subscribe((event) => stream.send("forge", event));

  const unfinished = (): ForgeJob[] => forge.list().filter((job) => !isFinished(job.status));

  return {
    designer,
    forge,
    provider,
    stream,

    status() {
      const { model, voice } = designer.status();
      return {
        provider,
        simulated: provider === "sim",
        ready: forge.ready(provider),
        model,
        voice,
        building: unfinished().length > 0,
      };
    },

    building: () => unfinished().length > 0,

    // list() is newest first, and builds run oldest first.
    activeJob: () => unfinished().at(-1) ?? null,

    lastConfirmed: () => (confirmed ? forge.get(confirmed.id) : null),

    async stop() {
      stopDesigner();
      stopForge();
      designer.stop();
      stream.close();
      await forge.stop();
    },
  };
}
