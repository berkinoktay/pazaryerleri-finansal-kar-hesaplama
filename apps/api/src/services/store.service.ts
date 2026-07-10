import { prisma } from '@pazarsync/db';
import type { MemberRole, Store as PrismaStore } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  getAdapter,
  StoreCredentialShapeError,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import {
  encryptCredentials,
  mapPrismaError,
  syncLog,
  syncLogService,
  SyncInProgressError,
} from '@pazarsync/sync-core';
import type { SyncType } from '@pazarsync/db';

import { NotFoundError, ValidationError } from '../lib/errors';
import type { ConnectStoreInput, Store } from '../validators/store.validator';
import {
  registerStoreWebhook,
  rotateStoreWebhookSecret,
  unregisterStoreWebhook,
} from './webhooks/trendyol-webhook.service';

/**
 * DB row → public wire shape. Explicit field allowlist — never spread
 * `...store` because the credentials column MUST NOT leak. SECURITY.md §4.
 */
function toStoreResponse(store: PrismaStore): Store {
  return {
    id: store.id,
    name: store.name,
    platform: store.platform,
    environment: store.environment,
    externalAccountId: store.externalAccountId,
    status: store.status,
    lastConnectedAt: store.lastConnectedAt?.toISOString() ?? null,
    lastSyncAt: store.lastSyncAt?.toISOString() ?? null,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

export async function list(
  organizationId: string,
  caller: { userId: string; role: MemberRole },
): Promise<Store[]> {
  // OWNER/ADMIN see every store in the org; MEMBER/VIEWER see only the stores
  // they hold a member_store_access grant for. This is the service-layer mirror
  // of can_access_store — Prisma runs as the postgres role and bypasses RLS, so
  // the filter must be applied here too.
  const where =
    caller.role === 'OWNER' || caller.role === 'ADMIN'
      ? { organizationId }
      : {
          organizationId,
          memberAccess: { some: { member: { userId: caller.userId, organizationId } } },
        };
  const rows = await prisma.store.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(toStoreResponse);
}

export async function getById(organizationId: string, storeId: string): Promise<Store> {
  const row = await prisma.store.findFirst({
    where: { id: storeId, organizationId },
  });
  if (row === null) {
    // 404 on cross-tenant access (existence non-disclosure, SECURITY.md §3).
    throw new NotFoundError('Store', storeId);
  }
  return toStoreResponse(row);
}

/**
 * Internal-use store lookup that returns the FULL Prisma row including
 * the encrypted credentials column. Used by the sync service and any
 * other code that needs to act on the store (e.g. decrypt credentials
 * for a marketplace API call). Never expose this row directly in an
 * HTTP response — use `getById` for that, which strips credentials.
 *
 * Throws `NotFoundError` on cross-tenant access — same non-disclosure
 * contract as `getById`.
 */
export async function requireOwnedStore(
  organizationId: string,
  storeId: string,
): Promise<PrismaStore> {
  const row = await prisma.store.findFirst({
    where: { id: storeId, organizationId },
  });
  if (row === null) {
    throw new NotFoundError('Store', storeId);
  }
  return row;
}

/**
 * Initial sync types in PRIORITY order — the worker claims FIFO by
 * `started_at`, so this array order IS the execution order:
 *
 *   1. PRODUCTS — variants must exist before webhook order intake, or the
 *                 order is skipped entirely (observed: 9 orders silently
 *                 dropped on 2026-06-11 because the catalog synced 4 h after
 *                 connect). This is why PRODUCTS runs first.
 *   2. ORDERS   — first run scans the forward-only seam `[store.createdAt, now]`
 *                 (no historical backfill by design). It closes three gaps the
 *                 webhook alone leaves open: a connect-time webhook registration
 *                 failure, a vendor-side activation delay before Trendyol starts
 *                 POSTing, and full order payloads for sparse CREATED webhooks.
 *
 * SETTLEMENTS and CLAIMS were removed from the bootstrap chain (owner decision
 * 2026-07-10). A freshly connected store has no local orders yet, so there is
 * nothing for settlement/claim financial rows to attach to — every row would
 * miss on write (order_not_found) and self-heal later anyway. The first
 * meaningful settlement work only arrives via the 6-hourly pg_cron fan-out days
 * after connect (Trendyol's payment cycle runs up to T+45), so enqueueing these
 * two at bootstrap merely burned vendor API quota and a serial worker slot on
 * guaranteed-empty scans. The pg_cron fan-outs still cover both types on their
 * normal cadence — this change is bootstrap-only.
 *
 * Design: docs/plans/2026-06-11-sync-bootstrap-cron-parity.md
 */
const BOOTSTRAP_SYNC_SEQUENCE: readonly SyncType[] = ['PRODUCTS', 'ORDERS'];

/**
 * Enqueue the initial sync chain for a freshly connected store.
 *
 * Non-blocking by contract (same stance as webhook registration): the store
 * row is already committed, so an enqueue failure must never surface to the
 * user — the hourly/6-hourly pg_cron fan-outs re-enqueue every type with the
 * same dedupe guard, so a missed bootstrap heals itself on the next tick.
 *
 * Each type gets `started_at = base + index` (ms) so the worker's
 * `ORDER BY started_at` claim preserves the priority order even when both
 * rows land in the same millisecond.
 */
async function bootstrapInitialSyncs(organizationId: string, storeId: string): Promise<void> {
  const baseTimeMs = Date.now();
  for (const [index, syncType] of BOOTSTRAP_SYNC_SEQUENCE.entries()) {
    try {
      await syncLogService.acquireSlot(organizationId, storeId, syncType, {
        startedAt: new Date(baseTimeMs + index),
      });
    } catch (err) {
      if (err instanceof SyncInProgressError) {
        // Slot already active for this (store, type) — nothing to do.
        continue;
      }
      syncLog.warn('store.bootstrap-sync-enqueue-failed', {
        storeId,
        syncType,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Connect + validate credentials atomically:
 *
 * 1. Gate SANDBOX via env flag (D4) — fail BEFORE any adapter work.
 * 2. Gate HEPSIBURADA at the route level (D5) — fail before registry.
 * 3. Probe the marketplace with the credentials — on failure, throw a
 *    closed-vocabulary domain error. A failed probe leaves no DB row.
 * 4. Encrypt credentials ONCE and persist.
 * 5. P2002 (unique constraint hit) → ConflictError via mapPrismaError.
 */
export async function connect(organizationId: string, input: ConnectStoreInput): Promise<Store> {
  // D4 — sandbox gate: server-side, happens before anything else.
  if (input.environment === 'SANDBOX' && process.env['ALLOW_SANDBOX_CONNECTIONS'] !== 'true') {
    throw new ValidationError([{ field: 'environment', code: 'SANDBOX_NOT_ALLOWED' }]);
  }

  const platform = input.credentials.platform;

  // D5 — only TRENDYOL is wired. HB does not reach here: the Zod
  // discriminator has no HEPSIBURADA branch today, so requests with
  // platform: HEPSIBURADA are rejected with VALIDATION_ERROR at the
  // validator layer. When the HB schema lands, the registry still
  // throws PLATFORM_NOT_YET_AVAILABLE until HB's factory is registered,
  // so this service stays correct without a second guard.

  // Adapter probe — throws one of MarketplaceAuthError / MarketplaceAccessError
  // / MarketplaceUnreachable / RateLimitedError / ValidationError.
  const adapter = getAdapter(platform, input.environment, input.credentials);
  const { externalAccountId } = await adapter.testConnection();

  // Encrypt AFTER the probe — no point encrypting something that fails
  // validation, and we never want plaintext credentials to persist even
  // transiently through a failed create path.
  const encrypted = encryptCredentials(input.credentials);

  let row: PrismaStore;
  try {
    row = await prisma.store.create({
      data: {
        organizationId,
        name: input.name,
        platform,
        environment: input.environment,
        externalAccountId,
        credentials: encrypted,
        status: 'ACTIVE',
        lastConnectedAt: new Date(),
      },
    });
  } catch (err) {
    // P2002 on (organizationId, platform, externalAccountId) → ConflictError.
    mapPrismaError(err);
  }

  // ─── Trendyol webhook register — all environments, non-blocking ────────
  // Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §7.2
  //
  // Register failure is intentionally non-blocking: the store IS created and
  // the user can manually retry via the rotate-secret endpoint. The real safety
  // net is the sync-worker webhook-reconcile tick — it heals any connect-time
  // failure (and base-URL/ngrok drift) on its next pass, and the hourly delta
  // sync covers webhooks missed in the meantime.
  //
  // SANDBOX registers too: dev/ngrok HTTPS callback URLs pass
  // assertValidCallbackUrl, so there is no reason to skip stage stores (the old
  // PRODUCTION-only gate left sandbox test orders unable to ever arrive).
  if (platform === 'TRENDYOL') {
    try {
      const { webhookId, encryptedSecret } = await registerStoreWebhook({
        storeId: row.id,
        credentials: input.credentials,
        env: row.environment,
      });
      row = await prisma.store.update({
        where: { id: row.id },
        data: { webhookId, webhookSecret: encryptedSecret, webhookActiveAt: new Date() },
      });
    } catch (err) {
      syncLog.warn('store.webhook-register-failed', {
        storeId: row.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Store fields stay null → UI will show "webhook bağlı değil" badge.
    }
  }

  // ─── Initial sync bootstrap — priority-ordered, non-blocking ───────────
  // Products + orders start flowing the moment the store is connected instead
  // of waiting for the first cron tick (PRODUCTS had no schedule at all; orders
  // otherwise wait up to 1 h). Settlements/claims are intentionally NOT
  // bootstrapped — see BOOTSTRAP_SYNC_SEQUENCE; the 6-hourly cron owns them.
  await bootstrapInitialSyncs(organizationId, row.id);

  return toStoreResponse(row);
}

export async function disconnect(organizationId: string, storeId: string): Promise<void> {
  // Full row needed: we may need credentials + webhookId for Trendyol DELETE.
  const row = await prisma.store.findFirst({ where: { id: storeId, organizationId } });
  if (row === null) {
    throw new NotFoundError('Store', storeId);
  }

  // ─── Trendyol webhook unregister — best-effort, non-blocking ───────────
  // CASCADE DELETE removes the local rows; this call removes the Trendyol-side
  // subscription so we don't leak entries against the 15-webhook-per-seller
  // cap (webhook-model.md §"Webhook Önemli Notlar"). Failure does not block
  // the delete — orphan Trendyol subscription is recoverable manually.
  if (row.platform === 'TRENDYOL' && row.webhookId !== null && row.webhookId.length > 0) {
    try {
      await unregisterStoreWebhook({
        credentials: decryptStoreCredentials(row),
        env: row.environment,
        webhookId: row.webhookId,
      });
    } catch (err) {
      syncLog.error('store.webhook-unregister-failed', {
        storeId: row.id,
        errorMessage: err instanceof Error ? err.message : String(err),
        orphanRisk: true,
        hint: 'Trendyol subscription may keep POSTing to a dead URL; reconcile cannot prune it once the seller has no ACTIVE stores.',
      });
    }
  }

  try {
    await prisma.store.delete({ where: { id: row.id } });
  } catch (err) {
    mapPrismaError(err);
  }
}

/**
 * Manual rotation of the per-store webhook Basic Auth credential.
 *
 * Trigger: leak/exposure suspicion, scheduled audit, or one-shot retry after
 * a failed `connect` register flow (Store.webhookId null → first call
 * registers; non-null → PUT update).
 *
 * Caller: `POST /api/v1/organizations/:orgId/stores/:storeId/webhook/rotate-secret`
 * gated on OWNER/ADMIN.
 */
export async function rotateWebhookSecret(
  organizationId: string,
  storeId: string,
): Promise<{ rotatedAt: string }> {
  const row = await prisma.store.findFirst({ where: { id: storeId, organizationId } });
  if (row === null) {
    throw new NotFoundError('Store', storeId);
  }
  if (row.platform !== 'TRENDYOL') {
    throw new ValidationError([
      { field: '(platform)', code: 'WEBHOOK_NOT_SUPPORTED_FOR_PLATFORM' },
    ]);
  }

  let decrypted: TrendyolCredentials;
  try {
    decrypted = decryptStoreCredentials(row);
  } catch (err) {
    // Only a well-decrypted-but-wrong-shape blob is the user's to fix (422).
    // A decrypt-chain failure keeps its true status: a missing/rotated
    // ENCRYPTION_KEY surfaces as 500 SERVER_CONFIG_ERROR, a tampered/corrupt
    // blob as 500 — don't mask a server/security fault as "credentials corrupted".
    if (err instanceof StoreCredentialShapeError) {
      throw new ValidationError([{ field: '(credentials)', code: 'STORE_CREDENTIALS_CORRUPTED' }]);
    }
    throw err;
  }

  let encryptedSecret: string;
  let webhookId: string;

  if (row.webhookId === null || row.webhookId.length === 0) {
    // First-time activation — same flow as connect() retry.
    const result = await registerStoreWebhook({
      storeId: row.id,
      credentials: decrypted,
      env: row.environment,
    });
    encryptedSecret = result.encryptedSecret;
    webhookId = result.webhookId;
  } else {
    // Existing subscription — PUT update at Trendyol with new credentials.
    const result = await rotateStoreWebhookSecret({
      storeId: row.id,
      credentials: decrypted,
      env: row.environment,
      webhookId: row.webhookId,
    });
    encryptedSecret = result.encryptedSecret;
    webhookId = row.webhookId;
  }

  const now = new Date();
  await prisma.store.update({
    where: { id: row.id },
    data: { webhookId, webhookSecret: encryptedSecret, webhookActiveAt: now },
  });

  return { rotatedAt: now.toISOString() };
}
