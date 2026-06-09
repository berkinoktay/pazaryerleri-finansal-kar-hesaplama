/**
 * Abortable delay. Resolves after `ms`, or rejects with an `AbortError`
 * `DOMException` if `signal` aborts first (and clears the pending timer).
 *
 * Single source of truth for the Trendyol fetchers' retry/backoff waits
 * (orders / products / settlements) — No Utility Duplication, root CLAUDE.md.
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal !== undefined) {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
