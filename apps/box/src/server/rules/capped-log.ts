// A text log that keeps only its last `max` characters: a built game's stderr, which its own code fills. It never
// reaches the screen or the server's journal line by line, so a chatty or hostile game can't flood either.

export interface CappedLog {
  append(text: string): void;
  text(): string;
}

export function createCappedLog(max: number): CappedLog {
  let kept = "";
  let dropped = false;
  return {
    append(text) {
      kept += text;
      if (kept.length > max) {
        kept = kept.slice(kept.length - max);
        dropped = true;
      }
    },
    text: () => (dropped ? `… (earlier output dropped)\n${kept}` : kept),
  };
}
