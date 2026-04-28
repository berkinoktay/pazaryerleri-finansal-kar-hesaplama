import { z } from '@hono/zod-openapi';
import { Platform, StoreEnvironment, StoreStatus } from '@pazarsync/db';

/**
 * Public Store representation — the shape returned on every store
 * endpoint. Has NO `credentials` field by design: credentials are
 * write-only and encrypted at rest.
 */
export const StoreSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '3f5c7b2a-0e4d-4a8b-8f2e-9c1a5b7d0f11' }),
    name: z.string().openapi({ example: 'Akyıldız Trendyol' }),
    platform: z.enum(Platform).openapi({ example: 'TRENDYOL' }),
    environment: z.enum(StoreEnvironment).openapi({ example: 'PRODUCTION' }),
    externalAccountId: z.string().openapi({
      description:
        'Publicly visible seller/merchant ID — stored unencrypted so the uniqueness ' +
        'constraint (one account per org) can be enforced without decrypt.',
      example: '99999',
    }),
    status: z.enum(StoreStatus).openapi({ example: 'ACTIVE' }),
    lastConnectedAt: z.string().datetime().nullable().openapi({ example: '2026-04-21T10:30:00Z' }),
    lastSyncAt: z.string().datetime().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: '2026-04-21T10:30:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-04-21T10:30:00Z' }),
  })
  .openapi('Store', {
    description: 'A connected marketplace account. Credentials are never returned in responses.',
  });

export const StoreListResponseSchema = z
  .object({ data: z.array(StoreSchema) })
  .openapi('StoreListResponse');

export const StoreSingleResponseSchema = StoreSchema;

/**
 * Input for POST /v1/organizations/:orgId/stores.
 *
 * `credentials` is a discriminated union by `platform` so TypeScript
 * narrows the correct shape per marketplace. Today only TRENDYOL is
 * wired; sending platform: HEPSIBURADA fails the Zod discriminator
 * match (no matching option) OR passes a future HB schema — either way
 * the route handler double-checks and throws PLATFORM_NOT_YET_AVAILABLE.
 */
const TrendyolCredentialsSchema = z.object({
  platform: z.literal('TRENDYOL'),
  supplierId: z
    .string()
    .regex(/^[A-Za-z0-9]+$/, 'INVALID_SUPPLIER_ID_FORMAT')
    .min(1, 'INVALID_SUPPLIER_ID_FORMAT')
    .max(20, 'INVALID_SUPPLIER_ID_FORMAT'),
  // Trendyol docs don't specify a key/secret format. This validation
  // only catches obvious copy-paste mistakes (too short, too long,
  // embedded whitespace); the real verification is the adapter probe
  // against Trendyol — wrong creds surface as MARKETPLACE_AUTH_FAILED.
  apiKey: z
    .string()
    .trim()
    .min(8, 'INVALID_API_KEY_FORMAT')
    .max(128, 'INVALID_API_KEY_FORMAT')
    .regex(/^\S+$/, 'INVALID_API_KEY_FORMAT'),
  apiSecret: z
    .string()
    .trim()
    .min(8, 'INVALID_API_KEY_FORMAT')
    .max(128, 'INVALID_API_KEY_FORMAT')
    .regex(/^\S+$/, 'INVALID_API_KEY_FORMAT'),
});

export const ConnectStoreInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'INVALID_NAME_TOO_SHORT')
      .max(80, 'INVALID_NAME_TOO_LONG')
      .openapi({ example: 'Ana Mağaza' }),
    environment: z.enum(StoreEnvironment).default('PRODUCTION').openapi({ example: 'PRODUCTION' }),
    credentials: z
      .discriminatedUnion('platform', [TrendyolCredentialsSchema])
      .openapi({ description: 'Platform-specific credentials. Never echoed back.' }),
  })
  .openapi('ConnectStoreInput');

export type Store = z.infer<typeof StoreSchema>;
export type ConnectStoreInput = z.infer<typeof ConnectStoreInputSchema>;
