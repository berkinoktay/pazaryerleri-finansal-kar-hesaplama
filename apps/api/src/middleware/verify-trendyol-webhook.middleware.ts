/**
 * Trendyol webhook receiver auth middleware.
 *
 * Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §4.3
 *
 * Auth model — store-scoped Basic Auth (HMAC YOK; Trendyol HMAC desteklemiyor):
 *   1. URL path: `/v1/webhooks/orders/:storeId`
 *   2. Authorization: Basic <base64(user:pass)> header
 *   3. Compare against Store.webhookSecret (AES-256-GCM decrypted at-rest)
 *      with `timingSafeEqual` — username + password ayrı ayrı constant-time
 *      compared (length mismatch'i de erken döndürmüyor).
 *
 * Failure mapping:
 *   - storeId not a UUID → 404 NotFoundError (guard BEFORE Prisma so a bad
 *     path segment never raises a Prisma P2023 → 500)
 *   - Store yoksa → 404 NotFoundError (cross-tenant non-disclosure SECURITY.md §3)
 *   - Store var ama webhookSecret null → 404 (webhook disabled — yine non-disclosure)
 *   - Authorization header eksik / malformed → 401 UnauthorizedError
 *   - Credential mismatch / decrypt failure / bad shape → 401 UnauthorizedError
 *
 * Credential-failure self-heal: repeated auth failures for one store are
 * counted in-memory. A legitimate Trendyol delivery always authenticates, so a
 * successful auth clears the store's counter (reset-on-success) — the threshold
 * only fills when the STORED secret is stale (e.g. a rotate landed remotely but
 * our row is behind). On crossing the threshold we null the store's
 * `webhookSecret`; the sync-worker reconciler then re-registers a fresh secret
 * within ~5 minutes. Until it does, this middleware returns 404 (webhook
 * disabled) — the expected transient state during the heal.
 *
 * Context set on success:
 *   - `store`: full Prisma Store row (route uses .organizationId, .externalAccountId, .platform)
 */

import { timingSafeEqual } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import { decryptCredentials, syncLog } from '@pazarsync/sync-core';
import { createMiddleware } from 'hono/factory';

import { NotFoundError, UnauthorizedError } from '../lib/errors';

/** RFC 4122 canonical form — the shape Prisma's `@db.Uuid` column accepts. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * In-memory credential-failure self-heal knobs. Exported so tests can drive the
 * signature deterministically.
 *
 * The trigger is a SUSTAINED-OUTAGE signature, not a raw count: self-heal fires
 * only when a store has failed at least `MIN_COUNT` times AND those failures
 * span at least `MIN_DURATION_MS`. Rationale (honest): a pure count is reachable
 * by an attacker burst in seconds (the route allows 120 requests/min), so a
 * count alone would let an attacker force a secret rotation. Requiring the
 * failures to also span 30+ minutes RAISES THE BAR — it does not make rotation
 * abuse impossible, but a short burst fails the duration test, and a real
 * Trendyol delivery clears the counter on its first success (reset-on-success).
 * The only pattern that produces the full signature is a genuinely stale stored
 * secret: EVERY delivery failing continuously for 30+ minutes, which lines up
 * with Trendyol's ~5-minute retry cadence. We keep counting all three reasons
 * (including `mismatch`) because the primary drift scenario — a rotate landed
 * remotely while our row is behind — surfaces as `mismatch`.
 */
export const WEBHOOK_AUTH_FAIL_MIN_COUNT = 5;
export const WEBHOOK_AUTH_FAIL_MIN_DURATION_MS = 30 * 60_000;
export const WEBHOOK_AUTH_FAIL_STALE_GAP_MS = 60 * 60_000;
export const MAX_TRACKED_STORES = 1000;

type CredentialFailureReason = 'mismatch' | 'decrypt_failed' | 'shape_invalid';

interface AuthFailureEntry {
  count: number;
  /** First failure of the current sustained window (drives the duration test). */
  firstAt: number;
  /** Most recent failure; a long gap restarts the window (a NEW outage). */
  lastAt: number;
}

// Module-level, per-process (mirrors the rate-limit store's single-pod model).
// Keyed by storeId; bounded by MAX_TRACKED_STORES with oldest-insertion eviction.
const authFailures = new Map<string, AuthFailureEntry>();

/**
 * Records one credential failure for a store and returns the updated entry. A
 * failure that lands more than `STALE_GAP_MS` after the previous one restarts
 * the window (it is a new outage, not a continuation of the old one).
 */
function recordAuthFailure(storeId: string): AuthFailureEntry {
  const now = Date.now();
  const existing = authFailures.get(storeId);
  const entry: AuthFailureEntry =
    existing === undefined || now - existing.lastAt > WEBHOOK_AUTH_FAIL_STALE_GAP_MS
      ? { count: 0, firstAt: now, lastAt: now }
      : existing;
  entry.count += 1;
  entry.lastAt = now;
  authFailures.set(storeId, entry);

  // Bound memory: evict the oldest-inserted key (Map iterates in insertion order).
  if (authFailures.size > MAX_TRACKED_STORES) {
    const oldest = authFailures.keys().next().value;
    if (oldest !== undefined) authFailures.delete(oldest);
  }
  return entry;
}

/**
 * Logs a credential failure, advances the self-heal counter, and — when the
 * sustained-outage signature is met — nulls the store's stale `webhookSecret`
 * so the reconciler can rotate a fresh one. Never logs the incoming credential.
 * Callers throw the matching `UnauthorizedError` immediately after.
 */
async function recordAndMaybeHealCredentialFailure(
  storeId: string,
  reason: CredentialFailureReason,
): Promise<void> {
  // storeId is not PII; the incoming credential is NEVER included.
  syncLog.warn('webhook.credential-mismatch', { storeId, reason });
  const entry = recordAuthFailure(storeId);
  const durationMet = Date.now() - entry.firstAt >= WEBHOOK_AUTH_FAIL_MIN_DURATION_MS;
  const countMet = entry.count >= WEBHOOK_AUTH_FAIL_MIN_COUNT;
  if (!countMet || !durationMet) return;

  syncLog.error('webhook.credential-mismatch-threshold', { storeId, count: entry.count });
  // Clear the counter FIRST: if the store.update below rejects, we must NOT
  // leave the entry in place, or every subsequent bad-auth request would
  // re-attempt the failing write and surface a 500 instead of the intended
  // 401. With the entry gone, a failed heal simply retries later once the
  // window rebuilds.
  authFailures.delete(storeId);
  try {
    await prisma.store.update({ where: { id: storeId }, data: { webhookSecret: null } });
  } catch (err) {
    // Swallow — the caller still throws its UnauthorizedError (clean 401). The
    // reconciler / a later window will get another chance to heal.
    syncLog.error('webhook.self-heal-update-failed', {
      storeId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Test-only helper: clears the in-memory failure counters between tests so each
 * test starts from a clean state. Not part of the stable public surface.
 */
export function _resetWebhookAuthFailuresForTests(): void {
  authFailures.clear();
}

/**
 * Test-only helper: shifts an existing store's failure window `ms` into the
 * past (both `firstAt` and `lastAt`) so a test can satisfy the duration test
 * without waiting 30 real minutes. No-op if the store has no tracked entry.
 */
export function _backdateWebhookAuthFailureForTests(storeId: string, ms: number): void {
  const entry = authFailures.get(storeId);
  if (entry === undefined) return;
  entry.firstAt -= ms;
  entry.lastAt -= ms;
}

interface WebhookSecretShape {
  username: string;
  password: string;
}

function isWebhookSecretShape(value: unknown): value is WebhookSecretShape {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['username'] === 'string' && typeof v['password'] === 'string';
}

/**
 * Constant-time string comparison. `timingSafeEqual` requires equal-length
 * buffers, so we compare lengths separately — but still execute a dummy
 * `timingSafeEqual` call on length mismatch to keep timing flat.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(8);
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

export const verifyTrendyolWebhookMiddleware = createMiddleware<{
  Variables: { store: Store };
}>(async (c, next) => {
  const storeId = c.req.param('storeId');
  if (storeId === undefined || storeId.length === 0) {
    throw new NotFoundError('Store', 'unknown');
  }
  // Guard the shape BEFORE hitting Prisma: a non-UUID path segment would make
  // the `@db.Uuid` query raise P2023 and collapse to a generic 500. Same 404
  // as "store missing" preserves non-disclosure (SECURITY.md §3).
  if (!UUID_PATTERN.test(storeId)) {
    throw new NotFoundError('Store', storeId);
  }

  // findFirst (not findUnique) for symmetry with the rest of the codebase's
  // 404 non-disclosure pattern.
  const store = await prisma.store.findFirst({ where: { id: storeId } });
  if (store === null || store.webhookSecret === null) {
    // Surface stale/unregistered webhook hits in api logs. These 404s were
    // server-side-silent (only the tunnel/ngrok showed them), which made the
    // "test orders never arrive" incident hard to diagnose. The sync-worker
    // reconciler heals the underlying cause (missing reg / dead storeId); this
    // logs the symptom. storeId is not PII — safe to log for triage.
    syncLog.warn('webhook.store-not-found-or-disabled', {
      storeId,
      reason: store === null ? 'store_not_found' : 'webhook_secret_null',
    });
    // Same 404 for "store missing" AND "webhook disabled" — caller cannot
    // distinguish, preserving non-disclosure (SECURITY.md §3).
    throw new NotFoundError('Store', storeId);
  }

  const authHeader = c.req.header('Authorization');
  if (authHeader === undefined) {
    throw new UnauthorizedError('Missing Authorization header');
  }
  if (!authHeader.startsWith('Basic ')) {
    throw new UnauthorizedError('Authorization header must use Basic scheme');
  }

  const encoded = authHeader.slice('Basic '.length).trim();
  if (encoded.length === 0) {
    throw new UnauthorizedError('Authorization header empty after scheme');
  }

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    throw new UnauthorizedError('Authorization header base64 decode failed');
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    throw new UnauthorizedError('Authorization header missing user:pass separator');
  }
  const incomingUser = decoded.slice(0, colonIdx);
  const incomingPass = decoded.slice(colonIdx + 1);

  // Decrypt stored credential blob (AES-256-GCM ciphertext base64).
  let stored: unknown;
  try {
    stored = decryptCredentials(store.webhookSecret);
  } catch {
    // Corrupted secret → treat as auth failure rather than 500. Operator can
    // rotate via `POST /stores/:id/webhook/rotate-secret` (PR-C4).
    await recordAndMaybeHealCredentialFailure(store.id, 'decrypt_failed');
    throw new UnauthorizedError('Webhook credential decrypt failed');
  }
  if (!isWebhookSecretShape(stored)) {
    await recordAndMaybeHealCredentialFailure(store.id, 'shape_invalid');
    throw new UnauthorizedError('Webhook credential shape invalid');
  }

  const userMatch = timingSafeEqualString(incomingUser, stored.username);
  const passMatch = timingSafeEqualString(incomingPass, stored.password);
  if (!userMatch || !passMatch) {
    await recordAndMaybeHealCredentialFailure(store.id, 'mismatch');
    throw new UnauthorizedError('Webhook credential mismatch');
  }

  // Reset-on-success: a real Trendyol delivery authenticates, clearing any
  // accumulated failures so the self-heal threshold only ever fills from a
  // genuinely stale stored secret (not a transient probe).
  authFailures.delete(store.id);

  c.set('store', store);
  await next();
});
