// Wire contract (request/response) for the saved Commission Tariffs API.
//
// Single source of truth: the service imports the inferred TS types from here, so
// the serialized shapes and the OpenAPI spec never drift. Money is always a GROSS
// (VAT-inclusive) decimal STRING; the frontend renders, never computes.

import { z } from '@hono/zod-openapi';

// ─── Shared enums ───────────────────────────────────────────────────────────

export const TariffValiditySchema = z
  .enum(['active', 'upcoming', 'past'])
  .openapi('TariffValidity', {
    description: 'Dönem geçerliliği — tarihler parse edilemezse null.',
  });

export const TariffItemReasonSchema = z
  .enum(['NO_PRODUCT', 'NO_COST', 'NO_SHIPPING'])
  .openapi('TariffItemReason', {
    description: 'Kâr hesaplanamama nedeni: ürün eşleşmedi / maliyet yok / kargo yok.',
  });

// ─── Path params ────────────────────────────────────────────────────────────

export const TariffStorePathSchema = z.object({
  orgId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'orgId', in: 'path' } }),
  storeId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'storeId', in: 'path' } }),
});

export const TariffIdPathSchema = TariffStorePathSchema.extend({
  tariffId: z
    .string()
    .uuid()
    .openapi({ param: { name: 'tariffId', in: 'path' } }),
});

// ─── List ───────────────────────────────────────────────────────────────────

export const CommissionTariffListItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    productCount: z.number().int(),
    selectedCount: z.number().int(),
    exported: z.boolean(),
    validity: TariffValiditySchema.nullable(),
    updatedAt: z.string().datetime(),
  })
  .openapi('CommissionTariffListItem');

export const CommissionTariffListResponseSchema = z
  .object({ data: z.array(CommissionTariffListItemSchema) })
  .openapi('CommissionTariffListResponse');

// ─── Detail (with computed per-band profit) ─────────────────────────────────

export const TariffBandResultSchema = z
  .object({
    key: z.string(),
    price: z.string(),
    commissionPct: z.string(),
    netProfit: z.string().nullable(),
    marginPct: z.string().nullable(),
  })
  .openapi('TariffBandResult');

export const TariffDetailItemSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string(),
    stockCode: z.string().nullable(),
    productTitle: z.string(),
    category: z.string().nullable(),
    brand: z.string().nullable(),
    currentPrice: z.string(),
    currentCommissionPct: z.string(),
    calculable: z.boolean(),
    reason: TariffItemReasonSchema.nullable(),
    bestBandKey: z.string().nullable(),
    selectedBand: z.string().nullable(),
    customPrice: z.string().nullable(),
    bands: z.array(TariffBandResultSchema),
  })
  .openapi('TariffDetailItem');

export const TariffPeriodSchema = z
  .object({
    id: z.string().uuid(),
    dateRangeLabel: z.string(),
    validity: TariffValiditySchema.nullable(),
    items: z.array(TariffDetailItemSchema),
  })
  .openapi('TariffPeriod');

export const CommissionTariffDetailSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    exported: z.boolean(),
    periods: z.array(TariffPeriodSchema),
  })
  .openapi('CommissionTariffDetail');

// ─── Inferred TS types (consumed by the service layer) ──────────────────────

export type CommissionTariffListItem = z.infer<typeof CommissionTariffListItemSchema>;
export type TariffBandResult = z.infer<typeof TariffBandResultSchema>;
export type TariffDetailItem = z.infer<typeof TariffDetailItemSchema>;
export type TariffPeriod = z.infer<typeof TariffPeriodSchema>;
export type CommissionTariffDetail = z.infer<typeof CommissionTariffDetailSchema>;
