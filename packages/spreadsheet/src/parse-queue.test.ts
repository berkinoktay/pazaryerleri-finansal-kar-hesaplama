import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpreadsheetFileError } from './errors';
import { createParseQueue } from './parse-queue';

// The queue runs one task at a time, refuses a call beyond `maxInFlight` at once, and
// gives up on a call that has waited `maxWaitMs` without starting. Tasks are fakes;
// time is faked, so the deadlines are exact.

const LIMITS = { maxInFlight: 8, maxWaitMs: 20_000 } as const;
const TASK_MS = 100;
const SHORT_WAIT_MS = 1_000;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A task that logs its start and end around TASK_MS of work, then returns `value`. */
function loggedTask<T>(log: string[], label: string, value: T): () => Promise<T> {
  return async () => {
    log.push(`start ${label}`);
    await new Promise((resolve) => setTimeout(resolve, TASK_MS));
    log.push(`end ${label}`);
    return value;
  };
}

interface Attempt<T> {
  readonly promise: Promise<T> | null;
  readonly thrown: unknown;
}

/** Calls `call`, keeping what it returns or what it throws synchronously. */
function attempt<T>(call: () => Promise<T>): Attempt<T> {
  try {
    return { promise: call(), thrown: null };
  } catch (e) {
    return { promise: null, thrown: e };
  }
}

function settledError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createParseQueue', () => {
  it('runs tasks one at a time in call order', async () => {
    const run = createParseQueue(LIMITS);
    const log: string[] = [];

    const results = Promise.all([
      run(loggedTask(log, '1', 'a')),
      run(loggedTask(log, '2', 'b')),
      run(loggedTask(log, '3', 'c')),
    ]);
    await vi.runAllTimersAsync();

    await expect(results).resolves.toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });

  it('runs the next task after a task rejects', async () => {
    const run = createParseQueue(LIMITS);
    const failure = new Error('task failed');

    const settled = Promise.allSettled([
      run(() => Promise.reject(failure)),
      run(() => Promise.resolve('next')),
    ]);
    await vi.runAllTimersAsync();

    expect(await settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'fulfilled', value: 'next' },
    ]);
  });

  it('refuses a call beyond maxInFlight synchronously with ENGINE_BUSY, and frees a slot once a task settles', async () => {
    const run = createParseQueue(LIMITS);
    const gates = Array.from({ length: LIMITS.maxInFlight }, () => deferred<string>());
    const inFlight = gates.map((gate) => run(() => gate.promise));

    const refused = attempt(() => run(() => Promise.resolve('refused')));

    expect(refused.promise).toBeNull();
    expect(refused.thrown).toBeInstanceOf(SpreadsheetFileError);
    if (refused.thrown instanceof SpreadsheetFileError) {
      expect(refused.thrown.code).toBe('ENGINE_BUSY');
      expect(refused.thrown.meta).toEqual({ cap: LIMITS.maxInFlight });
    }

    gates[0]?.resolve('first');
    await expect(inFlight[0]).resolves.toBe('first');
    const accepted = attempt(() => run(() => Promise.resolve('accepted')));
    expect(accepted.thrown).toBeNull();

    for (const gate of gates) gate.resolve('done');
    await vi.runAllTimersAsync();
    await expect(Promise.all(inFlight.slice(1))).resolves.toHaveLength(LIMITS.maxInFlight - 1);
    await expect(accepted.promise).resolves.toBe('accepted');
  });

  it('rejects a call still waiting after maxWaitMs with ENGINE_BUSY, never runs it, and frees its slot at once', async () => {
    const run = createParseQueue({ maxInFlight: 2, maxWaitMs: SHORT_WAIT_MS });
    const running = deferred<string>();
    const first = run(() => running.promise);
    const expiredTask = vi.fn(() => Promise.resolve('expired'));
    const expired = settledError(run(expiredTask));

    await vi.advanceTimersByTimeAsync(SHORT_WAIT_MS);
    const error = await expired;

    expect(error).toBeInstanceOf(SpreadsheetFileError);
    if (error instanceof SpreadsheetFileError) {
      expect(error.code).toBe('ENGINE_BUSY');
      expect(error.meta).toEqual({ waitedMs: SHORT_WAIT_MS });
    }
    // The expired call's slot is free while the first task still runs.
    const nextTask = vi.fn(() => Promise.resolve('next'));
    const next = attempt(() => run(nextTask));
    expect(next.thrown).toBeNull();

    // A running task is not subject to the wait deadline.
    running.resolve('first');
    await vi.runAllTimersAsync();
    await expect(first).resolves.toBe('first');
    await expect(next.promise).resolves.toBe('next');
    expect(nextTask).toHaveBeenCalledTimes(1);
    expect(expiredTask).not.toHaveBeenCalled();
  });
});
