// The game builder's HTTP wire: every route's path and what it answers, as the server (builder-api.ts), the screen's
// builder views and the test page's Builder tab all see them, so the three can't drift apart. Types and constants
// only: no DOM, no Node.
import type { MockTurn } from "../builder/designer/script.ts";
import type { DesignerState, ForgeEvent, ForgeJob, ForgeProvider, GameBrief } from "../builder/types.ts";
import type { SpokenLine, VoiceStatus } from "../builder/voice/port.ts";

export type { MockTurn, SpokenLine };

/** The launcher token's header on a request, and the meta tag the kiosk's page gets it in (security.ts). */
export const LAUNCHER_HEADER = "x-egb-launcher";
export const LAUNCHER_META = "egb-launcher";

/** Every builder route needs the launcher token; every one that isn't a GET also needs a local origin. */
export const BUILDER = {
  /** GET: BuilderStatus. */
  status: "/api/builder",
  /** GET: the open design (DesignerState), or null before one starts. */
  designer: "/api/builder/designer",
  /** POST {}: a new design, replacing any other. */
  start: "/api/builder/designer/start",
  /** POST ChooseBody: answers the step with one of its keys (on confirm, `build` builds). */
  choose: "/api/builder/designer/choose",
  /** POST AnswerBody: answers with typed words (the model reads them, at most 5 s). */
  answer: "/api/builder/designer/answer",
  /** POST SessionBody: reopens the step settled before this one. */
  back: "/api/builder/designer/back",
  /** POST SessionBody: builds the brief: ConfirmReply. */
  confirm: "/api/builder/designer/confirm",
  /** POST the recorded answer's bytes (content-type: its mime type; `?session=`): TranscribeReply. */
  transcribe: "/api/builder/voice/transcribe",
  /** POST SessionBody: the current question, spoken (`SpokenLine`). */
  speak: "/api/builder/voice/speak",
  /** GET `?file=`: a clip speak() named, as audio/mpeg. */
  clip: "/api/builder/voice/clip",
  /** GET: mock voice's scripted turns for the rest of the design (`MockTurn[]`; empty on ElevenLabs). */
  turns: "/api/builder/voice/turns",
  /** GET: every job kept, newest first (`ForgeJob[]`). */
  jobs: "/api/builder/forge/jobs",
  /** GET `?id=`: JobReply. */
  job: "/api/builder/forge/job",
  /** POST CancelBody: CancelReply. */
  cancel: "/api/builder/forge/cancel",
  /** POST RemoveBody: deletes an installed built game. 204. */
  remove: "/api/builder/forge/remove",
  /** GET: Server-Sent Events (`hello`, then `designer` and `forge`; `?job=` replays that job instead of the running one). */
  events: "/api/builder/events",
} as const;

export interface BuilderStatus {
  /** EGB_FORGE_PROVIDER: who builds. `sim` replays a recorded build and is shown SIMULATED. */
  readonly provider: ForgeProvider;
  readonly simulated: boolean;
  /** Whether the provider can build here now, and why not. */
  readonly ready: { readonly ok: boolean; readonly reason: string | null };
  /** Who reads typed and spoken answers: the model (`api`, `sdk`) or keywords alone (`off`). */
  readonly model: { readonly provider: "api" | "sdk" | "off"; readonly reason: string | null };
  readonly voice: VoiceStatus;
  /** A build is queued or running: the deploy's updater waits, and the Designer is locked. */
  readonly building: boolean;
}

export interface SessionBody {
  /** The design the screen is showing: a newer one answers 409 `stale` instead of being edited. */
  readonly session?: string;
}
export interface ChooseBody extends SessionBody {
  readonly choice: string;
}
export interface AnswerBody extends SessionBody {
  readonly text: string;
}
export interface CancelBody {
  readonly id: string;
}
export interface RemoveBody {
  readonly game: string;
}

export interface ConfirmReply {
  readonly brief: GameBrief;
  /** The build it started. */
  readonly job: ForgeJob;
}
export interface TranscribeReply {
  /** What was heard; null when nothing was. */
  readonly text: string | null;
  readonly state: DesignerState;
}
export interface JobReply {
  readonly job: ForgeJob;
  readonly events: readonly ForgeEvent[];
}
export interface CancelReply {
  /** false: it was installing or already over. */
  readonly cancelled: boolean;
}

/** A refusal: the HTTP status, and for the Designer's refusals its code (`stale`, `locked`, …). The body is its text. */
export const DESIGNER_CODE_HEADER = "x-egb-designer-code";

/** The stream's first event: where things stand, then the replayed job's events follow as `forge` events. */
export interface HelloEvent {
  readonly designer: DesignerState | null;
  /** The job replayed after this: `?job=`'s, else the one queued or running, else null. */
  readonly job: ForgeJob | null;
  readonly status: BuilderStatus;
}

/** Every event on BUILDER.events, by its SSE name. */
export interface BuilderEvents {
  readonly hello: HelloEvent;
  /** Every change of the design. */
  readonly designer: DesignerState;
  /** Every moment of every build. */
  readonly forge: ForgeEvent;
}
export type BuilderEventName = keyof BuilderEvents;
