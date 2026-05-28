import { prisma } from '@pazarsync/db';
import type { MemberRole, Store as PrismaStore } from '@pazarsync/db';
import { getAdapter, isTrendyolCredentials } from '@pazarsync/marketplace';
import {
  decryptCredentials,
  encryptCredentials,
  mapPrismaError,
  syncLog,
} from '@pazarsync/sync-core';

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

  // ─── Trendyol webhook register — PRODUCTION only, non-blocking ─────────
  // Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §7.2
  //
  // Register failure is intentionally non-blocking: the store IS created and
  // the user can manually retry via the rotate-secret endpoint. The 6-hour
  // delta sync (PR-D) covers the polling fallback so missed webhooks recover
  // automatically. We only attempt for TRENDYOL + PRODUCTION; SANDBOX skips
  // because Trendyol stage URL rejects the production tunnel/host string and
  // most stage testing predates the webhook subscription.
  if (platform === 'TRENDYOL' && row.environment === 'PRODUCTION') {
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
      const decrypted = decryptCredentials(row.credentials as string);
      if (isTrendyolCredentials(decrypted)) {
        await unregisterStoreWebhook({
          credentials: decrypted,
          env: row.environment,
          webhookId: row.webhookId,
        });
      }
    } catch (err) {
      syncLog.warn('store.webhook-unregister-failed', {
        storeId: row.id,
        errorMessage: err instanceof Error ? err.message : String(err),
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

  const decrypted = decryptCredentials(row.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new ValidationError([{ field: '(credentials)', code: 'STORE_CREDENTIALS_CORRUPTED' }]);
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
