// The Designer's voice on the page, behind its push-to-talk key. The Box's voice port decides how it works:
//
//   mock        (the default) no microphone and no network beyond the Box: the key plays the scripted player's next
//               line (GET turns) as a caption, then sends an empty take, and the Box "hears" that line and reads it.
//   elevenlabs  the key records while it is held (MediaRecorder) and the take goes up to be transcribed; each new
//               question is spoken from the clip the Box made (its words are on screen either way).
//
// Muted (the Box's mute, localStorage `gamebox-muted=1`), questions aren't spoken; the key still works. Every call to
// ElevenLabs is the Box's, behind its own monthly budget: nothing here talks to anything but the Box.
import type { VoiceStatus } from "../../builder/voice/port.ts";
import { BUILDER, type MockTurn, type SpokenLine, type TranscribeReply } from "../../server/builder-wire.ts";
import { getJson, postBytes, postJson } from "../views/builder-link.ts";
import { createClipPlayer } from "./clips.ts";
import { canRecord, createRecorder } from "./recorder.ts";

export interface DesignerVoiceHooks {
  /** What the key means now: shown under it. */
  onCaption(text: string): void;
  /** The key is live (recording, or the scripted line is being "said"). */
  onListening(on: boolean): void;
}

export interface DesignerVoice {
  readonly mode: VoiceStatus["mode"];
  /** The key went down. */
  press(): Promise<void>;
  /** The key came up: the answer goes to the Designer. null: nothing was said (or the take was too short). */
  release(session: string): Promise<TranscribeReply | null>;
  /** Speaks the question on screen, unless muted or the voice makes no clips. */
  speak(session: string): Promise<void>;
  /** Stops any recording or clip (the screen is leaving). */
  stop(): void;
}

export function createDesignerVoice(status: VoiceStatus, muted: () => boolean, hooks: DesignerVoiceHooks): DesignerVoice {
  const clips = createClipPlayer(muted);
  const recorder = createRecorder();
  const mock = status.mode === "mock";
  let pressed = false;

  const transcribe = (session: string, audio: Blob): Promise<TranscribeReply> =>
    postBytes<TranscribeReply>(`${BUILDER.transcribe}?session=${encodeURIComponent(session)}`, audio);

  return {
    mode: status.mode,

    async press() {
      if (pressed) return;
      pressed = true;
      clips.stop();
      hooks.onListening(true);
      if (mock) {
        // The scripted player's answer to the question on screen.
        const [turn] = await getJson<MockTurn[]>(BUILDER.turns).catch((): MockTurn[] => []);
        hooks.onCaption(turn ? `YOU: ${turn.hear}` : "NOTHING LEFT TO SAY");
        return;
      }
      if (!canRecord()) {
        hooks.onCaption("NO MICROPHONE: TAP A KEY OR TYPE");
        return;
      }
      try {
        await recorder.start();
        hooks.onCaption("LISTENING…");
      } catch {
        hooks.onCaption("THE MICROPHONE IS OFF: TAP A KEY OR TYPE");
      }
    },

    async release(session) {
      if (!pressed) return null;
      pressed = false;
      hooks.onListening(false);
      const audio = mock ? new Blob([], { type: "audio/webm" }) : await recorder.stop();
      if (!audio) return null;
      const reply = await transcribe(session, audio);
      // Mock voice showed its line on the press already.
      if (reply.text && !mock) hooks.onCaption(`YOU: ${reply.text}`);
      if (!reply.text) hooks.onCaption("DIDN'T CATCH THAT: TRY AGAIN, OR TAP A KEY");
      return reply;
    },

    async speak(session) {
      if (mock || muted()) return;
      const line = await postJson<SpokenLine>(BUILDER.speak, { session }).catch(() => null);
      if (line?.clip) await clips.play(line.clip);
    },

    stop() {
      clips.stop();
      if (recorder.recording) void recorder.stop();
      pressed = false;
    },
  };
}
