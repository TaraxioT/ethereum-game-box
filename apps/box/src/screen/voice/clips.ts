// Plays the Designer's spoken questions: a clip the Box made with ElevenLabs, fetched with the launcher token (the clip
// route needs it, so an <audio src> can't load it) and played through WebAudio, one at a time: a new question cuts the
// last one off. Muted (localStorage `gamebox-muted=1`, the Box's own mute), nothing plays. Never throws: a clip that
// can't load or play leaves the question on screen, which is always there anyway.
import { BUILDER } from "../../server/builder-wire.ts";
import { getBytes } from "../views/builder-link.ts";

export interface ClipPlayer {
  /** Plays the clip, stopping any other; resolves when it ends, is cut off or can't play. */
  play(clip: string): Promise<void>;
  stop(): void;
}

export function createClipPlayer(muted: () => boolean): ClipPlayer {
  let ctx: AudioContext | null = null;
  let current: { readonly source: AudioBufferSourceNode; readonly done: () => void } | null = null;
  /** Bumped by every play() and stop(): a clip still loading when a newer one is asked for never starts. */
  let turn = 0;

  function stop(): void {
    turn++;
    const playing = current;
    current = null;
    if (!playing) return;
    try {
      playing.source.stop();
    } catch {
      // Already over.
    }
    playing.done();
  }

  return {
    async play(clip) {
      stop();
      if (muted()) return;
      const mine = turn;
      try {
        // Made on a press (every play follows one), so the browser lets it sound.
        ctx ??= new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const audio = await ctx.decodeAudioData(await getBytes(`${BUILDER.clip}?file=${encodeURIComponent(clip)}`));
        if (mine !== turn || muted()) return;
        const source = ctx.createBufferSource();
        source.buffer = audio;
        source.connect(ctx.destination);
        await new Promise<void>((done) => {
          current = { source, done };
          source.onended = () => {
            if (current?.source === source) current = null;
            done();
          };
          source.start();
        });
      } catch {
        // No clip: the caption stands.
      }
    },
    stop,
  };
}
