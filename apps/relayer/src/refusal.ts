// A request the relayer won't pay for, with the HTTP status and the reason it sends back. Every refusal happens before
// any gas is spent.

export type RefusalStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

export class Refusal extends Error {
  readonly status: RefusalStatus;
  /** The contract error the call reverts with, decoded by name. */
  readonly revert: string | undefined;

  constructor(status: RefusalStatus, message: string, revert?: string) {
    super(message);
    this.status = status;
    this.revert = revert;
  }
}
