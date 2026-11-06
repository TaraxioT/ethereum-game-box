// The Story's step machine, apart from any page: Next shows a step and runs its writes, Back shows the step before
// without writing again, Retry runs a failed step's writes again, and Reset goes back to the start of the walkthrough
// (the chain keeps its state). A step's work that a later move has overtaken never changes the state.

export interface Step {
  id: string;
  title: string;
  /** The brief's words this step shows. */
  brief: string;
  /** The one-line caption under the title. */
  caption: string;
  /** Shows the step: navigation and reads only. */
  show(): void | Promise<void>;
  /** The step's real writes (and the reads after them). Steps with no writes leave it out. */
  act?(): Promise<void>;
}

export type StepState = "idle" | "running" | "done" | "failed";

export interface StoryView {
  index: number;
  state: StepState;
  error: string | null;
}

export class Story {
  private view: StoryView = { index: 0, state: "idle", error: null };
  /** Bumped by every move, so work from an overtaken move is ignored. */
  private generation = 0;

  constructor(
    readonly steps: readonly Step[],
    private readonly onChange: (view: StoryView) => void,
    private readonly onReset: () => void = () => {},
  ) {}

  get current(): StoryView {
    return this.view;
  }

  get canNext(): boolean {
    return this.view.index < this.steps.length - 1 && this.view.state !== "running";
  }

  get canBack(): boolean {
    return this.view.index > 0;
  }

  /** Moves to the next step, shows it and runs its writes. */
  next(): Promise<void> {
    if (!this.canNext) return Promise.resolve();
    return this.enter(this.view.index + 1, true);
  }

  /** Moves to the step before and shows it, without writing again. */
  back(): Promise<void> {
    if (!this.canBack) return Promise.resolve();
    return this.enter(this.view.index - 1, false);
  }

  /** Runs a failed step's writes again. */
  retry(): Promise<void> {
    if (this.view.state !== "failed") return Promise.resolve();
    return this.enter(this.view.index, true);
  }

  /** Back to the first step, with the walkthrough's own state cleared. */
  reset(): Promise<void> {
    this.onReset();
    return this.enter(0, false);
  }

  private async enter(index: number, write: boolean): Promise<void> {
    const generation = ++this.generation;
    const step = this.steps[index];
    if (!step) return;
    const act = write ? step.act : undefined;
    this.set({ index, state: act ? "running" : "done", error: null });
    try {
      await step.show();
      if (act) await act.call(step);
      if (generation === this.generation) this.set({ index, state: "done", error: null });
    } catch (err) {
      if (generation === this.generation) {
        this.set({ index, state: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private set(view: StoryView): void {
    this.view = view;
    this.onChange(view);
  }
}
