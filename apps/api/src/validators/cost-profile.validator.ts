import { z } from '@hono/zod-openapi';

import { CostProfileType, Currency, FxRateMode } from '@pazarsync/db/enums';

import { CursorMetaSchema } from '../openapi';

// ─── Shared field schemas ───────────────────────────────────────────────────

const CostProfileTypeSchema = z.enum(CostProfileType).openapi({
  description: 'Category of the cost. Used for profitability breakdown by type.',
  example: 'COGS',
});

const CurrencySchema = z.enum(Currency).openapi({
  description: 'ISO 4217 currency code for the cost amount.',
  example: 'TRY',
});

const FxRateModeSchema = z.enum(FxRateMode).openapi({
  description:
    'AUTO uses the daily TCMB rate fetched by the FX job. MANUAL requires a manualFxRate.',
  example: 'AUTO',
});

// ─── Base object (shared between create and update) ──────────────────────────
// The refines in createCostProfileSchema cannot coexist with .partial() in
// Zod 4. Split the base object so both schemas share the same field shapes.

const costProfileBaseObject = z.object({
  name: z.string().trim().min(1, 'NAME_REQUIRED').max(120, 'NAME_TOO_LONG').openapi({
    description: 'Profile display name. Unique within the organization.',
    example: 'Hammadde COGS',
  }),
  type: CostProfileTypeSchema,
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'AMOUNT_INVALID_FORMAT')
    .openapi({
      description: 'Cost amount as a decimal string (max 2 decimal places).',
      example: '25.50',
    }),
  currency: CurrencySchema.default('TRY'),
  vatRate: z
    .number()
    .int('VAT_RATE_MUST_BE_INTEGER')
    .min(0, 'VAT_RATE_TOO_SMALL')
    .max(100, 'VAT_RATE_TOO_LARGE')
    .default(0)
    .openapi({ description: 'VAT rate as a whole-number percentage (0–100).', example: 18 }),
  fxRateMode: FxRateModeSchema.default('AUTO'),
  manualFxRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'MANUAL_FX_RATE_INVALID_FORMAT')
    .optional()
    .openapi({
      description: 'Required when fxRateMode is MANUAL. Up to 6 decimal places.',
      example: '35.500000',
    }),
  note: z.string().trim().max(500, 'NOTE_TOO_LONG').optional().openapi({
    description: 'Optional free-text note for the profile.',
    example: 'Kumaş + dikiş maliyeti',
  }),
});

// ─── Create payload ─────────────────────────────────────────────────────────

/**
 * Validated create payload for POST /v1/organizations/:orgId/cost-profiles.
 *
 * Two cross-field invariants enforced by .refine():
 *   1. fxRateMode === 'MANUAL' → manualFxRate must be present and positive.
 *   2. currency === 'TRY' → fxRateMode must be 'AUTO' (TRY needs no conversion).
 */
export const createCostProfileSchema = costProfileBaseObject
  .refine(
    (data) => {
      if (data.fxRateMode === 'MANUAL') {
        return data.manualFxRate !== undefined && data.manualFxRate.length > 0;
      }
      return true;
    },
    { message: 'MANUAL_FX_RATE_REQUIRED', path: ['manualFxRate'] },
  )
  .refine(
    (data) => {
      if (data.currency === 'TRY') {
        return data.fxRateMode === 'AUTO';
      }
      return true;
    },
    { message: 'TRY_MUST_USE_AUTO_FX', path: ['fxRateMode'] },
  )
  .openapi('CreateCostProfileInput');

export type CreateCostProfileInput = z.infer<typeof createCostProfileSchema>;

// ─── Update payload ─────────────────────────────────────────────────────────

/**
 * PATCH payload — all fields optional. Zod 4 disallows .partial() on schemas
 * with refinements, so the update schema derives from the base object (no
 * refines). Cross-field invariants (MANUAL requires manualFxRate; TRY must be
 * AUTO) are re-validated by the service against the merged state.
 */
export const updateCostProfileSchema = costProfileBaseObject
  .partial()
  .openapi('UpdateCostProfileInput');

export type UpdateCostProfileInput = z.infer<typeof updateCostProfileSchema>;

// ─── List query params ───────────────────────────────────────────────────────

/**
 * Query params for GET /v1/organizations/:orgId/cost-profiles.
 * Cursor-based pagination: `cursor` is an opaque string from the previous
 * page's `meta.nextCursor`. `limit` defaults to 25, max 100.
 */
export const listCostProfilesQuerySchema = z
  .object({
    type: CostProfileTypeSchema.optional().openapi({
      description: 'Filter by cost type. Omit to return all types.',
    }),
    archived: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))
      .openapi({
        description: 'Filter by archive state. Omit to return only active (non-archived) profiles.',
        example: 'false',
      }),
    q: z.string().trim().min(1).max(100).optional().openapi({
      description: 'Case-insensitive substring match on profile name.',
      example: 'hammadde',
    }),
    cursor: z
      .string()
      .optional()
      .openapi({ description: 'Opaque pagination cursor from previous page meta.nextCursor.' }),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'LIMIT_TOO_SMALL')
      .max(100, 'LIMIT_TOO_LARGE')
      .default(25)
      .openapi({ description: 'Page size (1–100). Default 25.', example: 25 }),
  })
  .openapi('ListCostProfilesQuery');

export type ListCostProfilesQuery = z.infer<typeof listCostProfilesQuerySchema>;

// ─── Response schemas ────────────────────────────────────────────────────────

export const CostProfileSchema = z
  .object({
    id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    organizationId: z.string().uuid().openapi({ example: 'b4e2c1a0-9d3f-47e5-8a1b-6c5d4e3f2a1b' }),
    name: z.string().openapi({ example: 'Hammadde COGS' }),
    type: CostProfileTypeSchema,
    amount: z.string().openapi({ description: 'Decimal string', example: '25.50' }),
    currency: CurrencySchema,
    vatRate: z.number().int().openapi({ example: 18 }),
    fxRateMode: FxRateModeSchema,
    manualFxRate: z
      .string()
      .nullable()
      .openapi({ description: 'Decimal string or null', example: null }),
    note: z.string().nullable().openapi({ example: null }),
    archivedAt: z.string().datetime().nullable().openapi({ example: null }),
    createdBy: z.string().uuid().nullable().openapi({ example: null }),
    updatedBy: z.string().uuid().nullable().openapi({ example: null }),
    createdAt: z.string().datetime().openapi({ example: '2026-05-09T12:00:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-05-09T12:00:00Z' }),
  })
  .openapi('CostProfile');

export type CostProfileResponse = z.infer<typeof CostProfileSchema>;

export const ListCostProfilesResponseSchema = z
  .object({
    data: z.array(CostProfileSchema),
    meta: CursorMetaSchema,
  })
  .openapi('ListCostProfilesResponse');

// ─── Version response ────────────────────────────────────────────────────────

export const CostProfileVersionSchema = z
  .object({
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    organizationId: z.string().uuid(),
    version: z.number().int(),
    name: z.string(),
    type: CostProfileTypeSchema,
    amount: z.string().openapi({ description: 'Decimal string' }),
    currency: CurrencySchema,
    vatRate: z.number().int(),
    fxRateMode: FxRateModeSchema,
    manualFxRate: z.string().nullable(),
    note: z.string().nullable(),
    archivedAt: z.string().datetime().nullable(),
    changedFields: z.array(z.string()),
    changedBy: z.string().uuid().nullable(),
    changedAt: z.string().datetime(),
    changeReason: z.string().nullable(),
  })
  .openapi('CostProfileVersion');

export type CostProfileVersionResponse = z.infer<typeof CostProfileVersionSchema>;

export const ListCostProfileVersionsResponseSchema = z
  .object({
    data: z.array(CostProfileVersionSchema),
    meta: CursorMetaSchema,
  })
  .openapi('ListCostProfileVersionsResponse');

// ─── Attached-variant response ────────────────────────────────────────────────

export const AttachedVariantSchema = z
  .object({
    linkId: z.string().uuid().openapi({ description: 'product_variant_cost_profiles.id' }),
    productVariantId: z.string().uuid(),
    barcode: z.string(),
    stockCode: z.string(),
    productId: z.string().uuid(),
    productTitle: z.string(),
    attachedAt: z.string().datetime(),
    attachedBy: z.string().uuid().nullable(),
  })
  .openapi('AttachedVariant');

export type AttachedVariantResponse = z.infer<typeof AttachedVariantSchema>;

export const ListAttachedVariantsResponseSchema = z
  .object({
    data: z.array(AttachedVariantSchema),
    meta: CursorMetaSchema,
  })
  .openapi('ListAttachedVariantsResponse');
