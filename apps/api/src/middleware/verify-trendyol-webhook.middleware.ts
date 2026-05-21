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
 *   - Store yoksa → 404 NotFoundError (cross-tenant non-disclosure SECURITY.md §3)
 *   - Store var ama webhookSecret null → 404 (webhook disabled — yine non-disclosure)
 *   - Authorization header eksik / malformed → 401 UnauthorizedError
 *   - Credential mismatch → 401 UnauthorizedError (constant-time)
 *
 * Context set on success:
 *   - `store`: full Prisma Store row (route uses .organizationId, .externalAccountId, .platform)
 */

import { timingSafeEqual } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import { decryptCredentials } from '@pazarsync/sync-core';
import { createMiddleware } from 'hono/factory';

import { NotFoundError, UnauthorizedError } from '../lib/errors';

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

  // findFirst (not findUnique) for symmetry with the rest of the codebase's
  // 404 non-disclosure pattern.
  const store = await prisma.store.findFirst({ where: { id: storeId } });
  if (store === null || store.webhookSecret === null) {
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
    throw new UnauthorizedError('Webhook credential decrypt failed');
  }
  if (!isWebhookSecretShape(stored)) {
    throw new UnauthorizedError('Webhook credential shape invalid');
  }

  const userMatch = timingSafeEqualString(incomingUser, stored.username);
  const passMatch = timingSafeEqualString(incomingPass, stored.password);
  if (!userMatch || !passMatch) {
    throw new UnauthorizedError('Webhook credential mismatch');
  }

  c.set('store', store);
  await next();
});
