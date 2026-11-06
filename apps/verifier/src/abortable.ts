// For work that takes no signal, such as a call through a chain client.

/** `work`, or a rejection saying `why` the moment `signal` aborts. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal, why: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const stop = () => reject(new Error(why));
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    }),
  ]);
}
