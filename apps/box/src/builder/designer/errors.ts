// Refusals the Designer's routes turn straight into a reply: `status` is the HTTP code, `message` a sentence the
// screen can show as it is.

export type DesignerErrorCode = "no-session" | "stale" | "locked" | "bad-choice" | "empty" | "not-ready";

const STATUS: Record<DesignerErrorCode, number> = {
  "no-session": 404,
  stale: 409,
  locked: 409,
  "bad-choice": 400,
  empty: 400,
  "not-ready": 409,
};

export class DesignerError extends Error {
  readonly code: DesignerErrorCode;
  readonly status: number;
  constructor(code: DesignerErrorCode, message: string) {
    super(message);
    this.name = "DesignerError";
    this.code = code;
    this.status = STATUS[code];
  }
}
