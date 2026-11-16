/** Client open/closed state and caller cancellation, shared by the transport and token manager. */

import { clientClosedError } from './errors.js';

/**
 * The open/closed state one `PaylovClient` shares across its transports and token manager.
 * Closing never aborts a request already sent; it refuses every later send.
 */
export class ClientLifecycle {
  #closed = false;

  get closed(): boolean {
    return this.#closed;
  }

  close(): void {
    this.#closed = true;
  }

  assertOpen(): void {
    if (this.#closed) throw clientClosedError();
  }
}

/** Rejects a wait once its signal fires; never surfaced, so it carries nothing. */
class AbortedWait extends Error {}

/**
 * Settles with `promise`, or rejects once `signal` aborts, whichever comes first. Raced against
 * fetch and the body read, so the deadline holds even for a fetch that ignores its signal.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new AbortedWait());
    };
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/**
 * Waits for `promise` unless the caller's `signal` aborts first, then rejects with `aborted()`.
 * Only the wait is abandoned: a shared operation behind `promise` (a token grant) keeps running
 * for its other waiters.
 */
export async function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  aborted: () => Error,
): Promise<T> {
  if (signal === undefined) return promise;
  try {
    return await raceAbort(promise, signal);
  } catch (error) {
    if (signal.aborted) throw aborted();
    throw error;
  }
}
