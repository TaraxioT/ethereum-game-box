/** Why a run failed, sent to the Worker, which tries once more on a fresh container and then refunds. Its message is
 *  our own text: it never quotes the model or the log. */
export class RunFailure extends Error {}
