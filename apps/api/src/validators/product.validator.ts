import { z } from '@hono/zod-openapi';

import type { SyncLog } from '@pazarsync/db';

// ─── Sync trigger response ─────────────────────────────────────────────
// Returned from POST /v1/organizations/:orgId/stores/:storeId/products/sync
// immediately after the SyncLog row is inserted. The actual sync runs in
// the background; the client polls the SyncLog endpoint to track progress.

export const StartSyncResponseSchema = z
  .object({
    syncLogId: z.string().uuid().openapi({ example: '7f3a9b2e-4d6c-48a1-9f0e-2b5c8d1a4e6f' }),
    status: z.literal('RUNNING').openapi({ example: 'RUNNING' }),
    startedAt: z.string().datetime().openapi({ example: '2026-04-27T14:23:11.482Z' }),
  })
  .openapi('StartSyncResponse');

// ─── SyncLog response ──────────────────────────────────────────────────
// Public representation of a sync_logs row. Generic across SyncType so the
// same endpoint serves orders/settlements when those land. `progressTotal`
// is null until the first Trendyol page returns `totalElements`.

export const SyncLogResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '7f3a9b2e-4d6c-48a1-9f0e-2b5c8d1a4e6f' }),
    syncType: z.enum(['ORDERS', 'PRODUCTS', 'SETTLEMENTS']).openapi({ example: 'PRODUCTS' }),
    status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']).openapi({ example: 'RUNNING' }),
    startedAt: z.string().datetime().openapi({ example: '2026-04-27T14:23:11.482Z' }),
    completedAt: z.string().datetime().nullable().openapi({ example: null }),
    recordsProcessed: z.number().int().nonnegative().openapi({ example: 234 }),
    progressCurrent: z.number().int().nonnegative().openapi({ example: 234 }),
    progressTotal: z.number().int().nonnegative().nullable().openapi({ example: 1200 }),
    progressStage: z.string().nullable().openapi({ example: 'upserting' }),
    errorCode: z.string().nullable().openapi({ example: null }),
    errorMessage: z.string().nullable().openapi({ example: null }),
  })
  .openapi('SyncLogResponse', {
    description:
      'Generic sync_logs row representation. Used by the SyncCenter UI to render ' +
      'live progress for any active sync (PRODUCTS today, ORDERS / SETTLEMENTS later).',
  });

// ─── Mapper: Prisma row → SyncLogResponseSchema-compatible JSON ────────
// Keeps the ISO-8601 conversions in one place — services return Prisma
// rows, route handlers serialize via this helper.

export function toSyncLogResponse(row: SyncLog): {
  id: string;
  syncType: SyncLog['syncType'];
  status: SyncLog['status'];
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  progressStage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
} {
  return {
    id: row.id,
    syncType: row.syncType,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    recordsProcessed: row.recordsProcessed,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal,
    progressStage: row.progressStage,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}
