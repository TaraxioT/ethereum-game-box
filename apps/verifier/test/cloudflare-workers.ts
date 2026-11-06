// `cloudflare:workers` for the Node tests: the base classes, with nothing behind them.

export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState;
  protected env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected ctx: { props: Props };
  protected env: Env;
  constructor(ctx: { props: Props }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
