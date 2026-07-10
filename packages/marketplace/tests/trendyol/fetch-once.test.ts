// fetchOnce HTTP-layer hardening (sync-reliability):
//   - a caller-supplied signal must NOT disable the per-request timeout
//     (composition via AbortSignal.any) so a hung socket still fails fast;
//   - a caller abort is still rethrown as AbortError, not swallowed into the
//     transient-retry path;
//   - a pathological `Retry-After` is clamped to the cap (and warned) so the
//     serial worker cannot be parked for a day.
//
// Follows the fetch-mock pattern of the sibling endpoint tests
// (products.test.ts / claims.test.ts): stub globalThis.fetch per test.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceUnreachable, syncLog } from '@pazarsync/sync-core';

import { fetchOnce } from '../../src/trendyol/fetch-once';
import type { TrendyolCredentials } from '../../src/trendyol/types';

const URL_UNDER_TEST = 'https://stage.trendyol.test/x';
const CREDS: TrendyolCredentials = {
  supplierId: '2738',
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A fetch stand-in that never settles on its own but mirrors real fetch's
// abort semantics: it rejects with the composed signal's abort reason the
// moment that signal fires — whether from the caller's cancellation or from
// the per-request timeout. This lets us observe which of the two composed
// signals actually reaped the request.
function hangingFetchThatHonorsAbort(): ReturnType<typeof vi.fn> {
  return vi.fn((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? null;
      if (signal === null) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchOnce', () => {
  it('keeps the per-request timeout even when the caller passes its own signal', async () => {
    // The caller's controller never aborts, so the ONLY thing that can end a
    // hung request is the composed per-request timeout. Before the fix the
    // caller signal replaced the timeout and this would hang forever.
    const controller = new AbortController();
    const fetchMock = hangingFetchThatHonorsAbort();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchOnce(URL_UNDER_TEST, {
        credentials: CREDS,
        env: 'PRODUCTION',
        signal: controller.signal,
        requestTimeoutMs: 20,
        initialBackoffMs: 1,
      }),
    ).rejects.toBeInstanceOf(MarketplaceUnreachable);

    // An elapsed timeout is classified as a transient network error, so it
    // drives the retry loop — fetch is attempted more than once before the
    // retries are exhausted.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('rethrows a caller abort as AbortError instead of retrying it', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', hangingFetchThatHonorsAbort());

    await expect(
      fetchOnce(URL_UNDER_TEST, {
        credentials: CREDS,
        env: 'PRODUCTION',
        signal: controller.signal,
        // Long timeout: the caller abort is what fires, not the timeout.
        requestTimeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clamps a pathological Retry-After to the cap and warns (does not park for a day)', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '86400' }, // 86400s = 24h
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchOnce<{ ok: boolean }>(URL_UNDER_TEST, {
      credentials: CREDS,
      env: 'PRODUCTION',
    });

    // Let the first (429) response resolve so the retry sleep is scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // One tick short of the 120s cap: still sleeping, no retry yet — proof the
    // wait is bounded at the cap, NOT at the header's 24 hours.
    await vi.advanceTimersByTimeAsync(120_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Reaching the cap releases the retry, which succeeds.
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(warnSpy).toHaveBeenCalledWith(
      'trendyol.retry-after-clamped',
      expect.objectContaining({ requestedWaitMs: 86_400_000, cappedWaitMs: 120_000 }),
    );
  });
});
