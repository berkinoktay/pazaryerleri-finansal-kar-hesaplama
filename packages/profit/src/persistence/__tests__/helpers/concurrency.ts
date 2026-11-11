/**
 * Concurrency primitives shared by the persistence integration tests. A `Deferred`
 * exposes its resolver so a test can hold a transaction open across an await and
 * release it on cue, and `delay` waits a fixed span without a busy loop. Promoted
 * here on the third use (recompute-queue and recompute-parcel-profit were the first
 * two). It carries no `.test.ts` suffix, so neither vitest config picks it up as a
 * test file.
 */

/** A promise with its resolver exposed, to coordinate a concurrent holder. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

/** Builds a Deferred; the executor runs synchronously, so `resolve` is always set. */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Resolves after `ms`, used to wait without a busy loop. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}
