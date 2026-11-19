import { SpreadsheetFileError } from './errors';

// One workbook parse at a time per process. A parse builds an xmldom DOM that can need
// about 800 MB of worker heap at MAX_XML_DOM_WEIGHT (measured 2026-11-19, see
// constants.ts); run one after another, the process peak stays at
// about one parse whatever the number of uploads in flight. Two limits bound the
// wait instead of the memory, so one tenant's burst of large uploads cannot keep every
// other tenant's import or export waiting for minutes:
//   - at most `maxInFlight` calls are in flight (running or waiting); one more is
//     refused at once with ENGINE_BUSY;
//   - a call that has not started within `maxWaitMs` gives up with ENGINE_BUSY.

export interface ParseQueueLimits {
  /** Calls in flight (the running one plus those waiting) beyond which a call is refused. */
  readonly maxInFlight: number;
  /** How long a call may wait for its turn before it gives up. */
  readonly maxWaitMs: number;
}

/**
 * A queue that runs each task after every earlier task has settled; a failed task
 * does not stop the queue. The returned function:
 *   - throws SpreadsheetFileError ENGINE_BUSY `{ cap }` synchronously, without
 *     queueing, when `maxInFlight` calls are already in flight;
 *   - rejects with SpreadsheetFileError ENGINE_BUSY `{ waitedMs }` when the task has
 *     not started within `maxWaitMs`; the call's slot is released at that moment and
 *     its task never runs. A task that has started is not subject to the deadline.
 */
export function createParseQueue(
  limits: ParseQueueLimits,
): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  let inFlight = 0;

  return <T>(task: () => Promise<T>): Promise<T> => {
    if (inFlight >= limits.maxInFlight) {
      throw new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', {
        cap: limits.maxInFlight,
      });
    }
    inFlight += 1;
    // The only reference to the task that outlives this call. The closures below read
    // `pending`, never `task`, so dropping it on expiry lets the task (and the upload
    // buffer it closes over) be collected even while earlier tasks still run.
    let pending: (() => Promise<T>) | null = task;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      inFlight -= 1;
    };

    return new Promise<T>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const deadline = setTimeout(() => {
        pending = null;
        release();
        reject(
          new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse waited too long in the queue', {
            waitedMs: Date.now() - enqueuedAt,
          }),
        );
      }, limits.maxWaitMs);

      const turn = tail.then(async () => {
        // An expired call's turn is a no-op: the next call starts right away.
        const run = pending;
        if (run === null) return;
        pending = null;
        clearTimeout(deadline);
        try {
          resolve(await run());
        } catch (e) {
          reject(e);
        } finally {
          release();
        }
      });
      tail = turn.then(
        () => undefined,
        () => undefined,
      );
    });
  };
}
