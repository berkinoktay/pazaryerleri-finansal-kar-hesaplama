// Hold a strong reference to in-flight background promises until they
// settle, so the Node runtime doesn't garbage-collect them and so any
// uncaught rejection logs once instead of warning across many event-loop
// ticks. Used by route handlers that hand work off (e.g. ProductSyncService.run)
// after returning a 202 to the client.

const inFlight = new Set<Promise<unknown>>();

export function runInBackground(promise: Promise<unknown>): void {
  inFlight.add(promise);
  promise
    .catch((err: unknown) => {
      console.error('[run-in-background] uncaught background-task error:', err);
    })
    .finally(() => {
      inFlight.delete(promise);
    });
}

export function inFlightBackgroundCount(): number {
  return inFlight.size;
}
