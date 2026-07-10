// Shared retry-aware single-URL fetcher for every Trendyol endpoint module
// (products / orders / settlements / cargo-invoice / claims). Promoted from
// four identical per-module copies (#76); the call contract below is the
// union of what those copies enforced — do not fork this back into modules.

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable, RateLimitedError, syncLog } from '@pazarsync/sync-core';

import { sleep } from '../lib/sleep';
import { mapTrendyolResponseToDomainError } from './errors';
import { buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_RETRIES = 4; // 1s + 2s + 4s + 8s = 15s — under any reasonable Trendyol Retry-After
const INITIAL_BACKOFF_MS = 1_000;
// A vendor Retry-After is honored, but capped: the sync worker is serial, so a
// pathological header (e.g. "Retry-After: 86400") would park the whole worker
// for a day. 120s is comfortably longer than any legitimate Trendyol throttle
// window while keeping a stuck header bounded.
const RETRY_AFTER_CAP_MS = 120_000;

export interface FetcherDeps {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  signal?: AbortSignal;
  /** Test hook: backoff base in ms (default 1s). */
  initialBackoffMs?: number;
  /** Test hook: per-request timeout in ms (default REQUEST_TIMEOUT_MS). */
  requestTimeoutMs?: number;
}

/**
 * GET one Trendyol URL with auth headers and bounded retry.
 *
 * Retry policy:
 *   - **429 / 5xx** — exponential backoff honoring `Retry-After` when
 *     present, otherwise exponential. Up to MAX_BACKOFF_RETRIES. A
 *     single Trendyol gateway hiccup mid-sync used to kill the whole
 *     run; the retry path covers the common case where the next
 *     request 200s. Sandbox 503 is excluded because Trendyol uses it
 *     for "stage IP not whitelisted" — a permanent config issue, not
 *     a blip. Production 503 IS transient per Trendyol's official
 *     error-codes doc and gets retried.
 *   - **Network error / timeout** (fetch threw) — same backoff. We
 *     can't read a status code, so we treat it like a 5xx.
 *   - Anything else (401/403/4xx other than 429, sandbox 503) — no
 *     retry; the condition is permanent (bad credentials, missing
 *     User-Agent, IP allowlist).
 *
 * Once retries are exhausted, all 4xx and most 5xx (i.e. anything
 * other than networkError + 429) read the response body for diagnostic
 * capture, then delegate to `mapTrendyolResponseToDomainError(res, env,
 * diagnostics)` which routes by env (sandbox 503 → AccessError; prod
 * 503 → Unreachable+snippet) and status (401 → AuthError, 403 →
 * AccessError, generic 4xx + 5xx → Unreachable+snippet).
 *
 * The `as T` cast follows the established module convention; runtime
 * schema validation (Zod) remains a tracked follow-up.
 *
 * Note: this fetch-level retry is complementary to the sync-worker's
 * chunk-level retry (`handleRunError` → `markRetryable` with longer
 * backoffs in apps/sync-worker). A single 5xx blip recovers here
 * without restarting the chunk; only a sustained outage falls through
 * to the worker's chunk-level retry.
 */
export async function fetchOnce<T>(url: string, deps: FetcherDeps): Promise<T> {
  const initialBackoffMs = deps.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  let attempt = 0;
  for (;;) {
    let res: Response | undefined;
    let networkError = false;
    try {
      // Compose the caller's cancellation signal with a per-request timeout.
      // Passing `deps.signal` alone (the old behavior) silently dropped the
      // timeout whenever a caller supplied its own signal, so a hung socket
      // stalled the serial worker until the chunk watchdog reaped it.
      // AbortSignal.any aborts as soon as EITHER source fires (Node >= 20.19).
      const timeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal =
        deps.signal !== undefined ? AbortSignal.any([deps.signal, timeoutSignal]) : timeoutSignal;
      res = await fetch(url, {
        headers: {
          Authorization: buildAuthHeader(deps.credentials),
          'User-Agent': buildUserAgent(deps.credentials),
          Accept: 'application/json',
        },
        signal,
      });
    } catch (err) {
      // A caller-initiated abort surfaces as a DOMException named 'AbortError'
      // and is rethrown untouched — cancellation is not a fault. An elapsed
      // per-request timeout surfaces as a DOMException named 'TimeoutError',
      // which is NOT an AbortError, so it falls through to networkError=true and
      // is retried like a 5xx/network blip. That matches the pre-composition
      // behavior: the sole-timeout path already classified an elapsed timeout
      // as a transient network error.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      networkError = true;
    }

    if (res !== undefined && res.ok) {
      return (await res.json()) as T;
    }

    const sandbox503 = res !== undefined && res.status === 503 && deps.env === 'SANDBOX';
    const isTransient =
      networkError ||
      (res !== undefined && (res.status === 429 || (res.status >= 500 && !sandbox503)));

    if (isTransient && attempt < MAX_BACKOFF_RETRIES) {
      const headerSeconds =
        res !== undefined ? parseRetryAfterSeconds(res.headers.get('Retry-After')) : null;
      const requestedWaitMs =
        headerSeconds !== null ? headerSeconds * 1000 : initialBackoffMs * Math.pow(2, attempt);
      const waitMs = clampRetryWait(requestedWaitMs, url);
      attempt += 1;
      await sleep(waitMs, deps.signal);
      continue;
    }

    if (networkError || res === undefined) {
      throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0, url });
    }
    if (res.status === 429) {
      const seconds = parseRetryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
      throw new RateLimitedError(seconds, 'Trendyol rate limit hit (retries exhausted)');
    }
    const snippet = await safeReadBody(res);
    const xRequestId = res.headers.get('X-Request-ID') ?? undefined;
    mapTrendyolResponseToDomainError(res, deps.env, {
      url,
      xRequestId,
      responseBodySnippet: snippet,
    });
  }
}

/**
 * Best-effort capture of a failed Response body for diagnostics. Bounded
 * to 1 KB to keep the SyncLog row reasonable; never throws (a body that
 * has already been consumed or one that's binary garbage just yields
 * undefined). Plain text — Trendyol's 5xx surface is JSON or short HTML
 * and we want it readable in the logs.
 */
async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.slice(0, 1024);
  } catch {
    return undefined;
  }
}

/**
 * Clamp a computed retry wait to RETRY_AFTER_CAP_MS. A pathological vendor
 * `Retry-After` (e.g. 86400) would otherwise park the serial worker for a day;
 * when the clamp kicks in we log a warning so the excess wait is visible in the
 * logs instead of a silent stall. Exponential-backoff waits are always well
 * under the cap, so in practice this only ever fires on a Retry-After header.
 */
function clampRetryWait(requestedWaitMs: number, url: string): number {
  if (requestedWaitMs <= RETRY_AFTER_CAP_MS) return requestedWaitMs;
  syncLog.warn('trendyol.retry-after-clamped', {
    url,
    requestedWaitMs,
    cappedWaitMs: RETRY_AFTER_CAP_MS,
  });
  return RETRY_AFTER_CAP_MS;
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
