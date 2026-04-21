import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';

import { getAdapter } from '../integrations/marketplace/registry';
import { encryptCredentials } from '../lib/crypto';
import { NotFoundError, ValidationError } from '../lib/errors';
import { mapPrismaError } from '../lib/map-prisma-error';
import type { ConnectStoreInput, Store } from '../validators/store.validator';

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

export async function list(organizationId: string): Promise<Store[]> {
  const rows = await prisma.store.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
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

  try {
    const row = await prisma.store.create({
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
    return toStoreResponse(row);
  } catch (err) {
    // P2002 on (organizationId, platform, externalAccountId) → ConflictError.
    mapPrismaError(err);
  }
}

export async function disconnect(organizationId: string, storeId: string): Promise<void> {
  // findFirst + explicit delete (vs. deleteMany returning count) so we
  // get the 404 non-disclosure branch for cross-tenant / missing cases.
  const row = await prisma.store.findFirst({
    where: { id: storeId, organizationId },
    select: { id: true },
  });
  if (row === null) {
    throw new NotFoundError('Store', storeId);
  }
  try {
    await prisma.store.delete({ where: { id: row.id } });
  } catch (err) {
    mapPrismaError(err);
  }
}
