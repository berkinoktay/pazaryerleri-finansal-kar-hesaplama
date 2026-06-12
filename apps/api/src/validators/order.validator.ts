import { z } from '@hono/zod-openapi';

import {
  OrderFeeDirection,
  OrderFeeSource,
  OrderFeeType,
  OrderStatus,
  Platform,
  ProfitExclusionReason,
  ReconciliationStatus,
} from '@pazarsync/db/enums';

import { TableMetaSchema, TablePaginationQuerySchema } from '../openapi';

// ─── Domain enums (wire-shape) ────────────────────────────────────────────

const OrderStatusSchema = z.enum(OrderStatus).openapi({
  description:
    'Lifecycle state echoed from the marketplace. PENDING/PROCESSING precede SHIPPED; ' +
    'CANCELLED and RETURNED are terminal. DELIVERED is the gate for the settlement cycle.',
  example: 'DELIVERED',
});

const ReconciliationStatusSchema = z.enum(ReconciliationStatus).openapi({
  description:
    'Settlement progression. NOT_SETTLED = only ESTIMATE fees written. PARTIALLY_SETTLED = ' +
    'at least one SETTLEMENT/CARGO_INVOICE fee. FULLY_SETTLED = PaymentOrder confirmed + ' +
    'settledNetProfit written.',
  example: 'PARTIALLY_SETTLED',
});

const OrderFeeTypeSchema = z.enum(OrderFeeType).openapi({
  description: 'Fee category (PLATFORM_SERVICE, SHIPPING, STOPPAGE, COMMISSION_REFUND, …).',
  example: 'PLATFORM_SERVICE',
});

const OrderFeeSourceSchema = z.enum(OrderFeeSource).openapi({
  description: 'Origin of the fee row (ESTIMATE deterministic, SETTLEMENT vendor, …).',
  example: 'ESTIMATE',
});

const OrderFeeDirectionSchema = z.enum(OrderFeeDirection).openapi({
  description: 'DEBIT reduces seller revenue; CREDIT refunds/positive adjustments.',
  example: 'DEBIT',
});

const PlatformSchema = z.enum(Platform).openapi({
  description: 'Marketplace platform of the parent store.',
  example: 'TRENDYOL',
});

// ─── List query ────────────────────────────────────────────────────────────

/**
 * Query params for GET .../stores/{storeId}/orders. Table-based pagination
 * (page + perPage) because the orders page is a finite, page-navigable surface,
 * not an infinite-scroll feed. All filters compose via AND.
 */
export const listOrdersQuerySchema = TablePaginationQuerySchema.extend({
  status: OrderStatusSchema.optional().openapi({
    description: 'Filter by marketplace status. Omit for all statuses.',
  }),
  reconciliationStatus: ReconciliationStatusSchema.optional().openapi({
    description: 'Filter by settlement progression. Omit for all.',
  }),
  from: z.coerce.date().optional().openapi({
    description: 'Inclusive lower bound on Order.orderDate (ISO 8601).',
    example: '2026-04-01T00:00:00.000Z',
  }),
  to: z.coerce.date().optional().openapi({
    description: 'Inclusive upper bound on Order.orderDate (ISO 8601).',
    example: '2026-05-23T23:59:59.999Z',
  }),
  q: z.string().trim().min(1).max(120).optional().openapi({
    description: 'Substring match on platformOrderNumber or platformOrderId.',
    example: 'TY-2024',
  }),
  costStatus: z
    .enum(['calculated', 'excluded'])
    .optional()
    .openapi({
      description:
        "Filter by profit universe (spec 2026-06-12 calculated-or-excluded). 'calculated' = " +
        "estimatedNetProfit set; 'excluded' = profit_excluded_at set (cost window missed — " +
        'permanent). There is no pending state: orders persist in one of the two. Omit for all.',
      example: 'excluded',
    }),
}).openapi('ListOrdersQuery');

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// ─── List item ─────────────────────────────────────────────────────────────

/**
 * Compact row for the orders table. The list does not embed items/fees/claims —
 * those land via the detail endpoint to keep payloads bounded.
 */
export const OrderListItemSchema = z
  .object({
    id: z.string().uuid(),
    platformOrderId: z.string().openapi({ example: '1234567890' }),
    platformOrderNumber: z.string().nullable().openapi({ example: 'TY-987654' }),
    orderDate: z.string().datetime().openapi({ example: '2026-04-15T14:30:00.000Z' }),
    status: OrderStatusSchema,
    reconciliationStatus: ReconciliationStatusSchema,
    saleSubtotalNet: z.string().nullable().openapi({
      description: 'Net sale total (decimal string) — null until OrderItems are synced.',
      example: '249.50',
    }),
    saleVatTotal: z.string().nullable().openapi({
      description: 'KDV total over the sale (decimal string).',
      example: '49.90',
    }),
    estimatedNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Net profit estimated at T+0 by applyEstimateOnOrderCreate. Write-once; ' +
          'never updated after the order is created.',
        example: '78.40',
      }),
    settledNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Net profit reconciled with settlement data. Mutable as Return/Discount transactions ' +
          'flow in. Null until the first SETTLEMENT row is processed.',
        example: '75.10',
      }),
    fastDelivery: z.boolean(),
    micro: z.boolean(),
    itemCount: z.number().int().nonnegative().openapi({
      description: 'Number of OrderItems on this order.',
      example: 2,
    }),
  })
  .openapi('OrderListItem');

export type OrderListItemResponse = z.infer<typeof OrderListItemSchema>;

export const ListOrdersResponseSchema = z
  .object({
    data: z.array(OrderListItemSchema),
    pagination: TableMetaSchema,
    counts: z
      .object({
        calculated: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative().openapi({
          description: 'Profit-excluded orders (profit_excluded_at set — permanent).',
        }),
      })
      .openapi({
        description:
          'Profit-universe segment totals. Honor the sibling filters (status/recon/date/q) but ' +
          'ignore costStatus, so each tab shows its true count regardless of the active segment.',
      }),
  })
  .openapi('ListOrdersResponse');

// ─── Detail: nested shapes ────────────────────────────────────────────────

const OrderItemVariantSchema = z
  .object({
    id: z.string().uuid(),
    barcode: z.string().nullable().openapi({ example: '8690000000000' }),
    productName: z.string().openapi({ example: 'Yetişkin tişört — siyah, M' }),
    productImageUrl: z.string().url().nullable().openapi({ example: null }),
    marketplaceProductCode: z.string().nullable().openapi({ example: 'SKU-XYZ-M' }),
  })
  .openapi('OrderItemVariant');

const OrderItemDetailSchema = z
  .object({
    id: z.string().uuid(),
    quantity: z.number().int().positive(),
    // Net+VAT split. Nullable on legacy rows that pre-date PR-3 KDV migration.
    unitPriceNet: z.string().nullable().openapi({ description: 'Decimal string.' }),
    unitVatRate: z.string().nullable().openapi({ description: 'VAT rate %, decimal string.' }),
    unitVatAmount: z.string().nullable().openapi({ description: 'Decimal string.' }),
    // Commission split — always present (default 0 in schema).
    grossCommissionAmountNet: z.string().openapi({ description: 'Decimal string.' }),
    grossCommissionVatAmount: z.string().openapi({ description: 'Decimal string.' }),
    refundedCommissionAmountNet: z.string().openapi({ description: 'Decimal string.' }),
    refundedCommissionVatAmount: z.string().openapi({ description: 'Decimal string.' }),
    // Seller-side discount.
    sellerDiscountNet: z.string().openapi({ description: 'Decimal string.' }),
    sellerDiscountVatAmount: z.string().openapi({ description: 'Decimal string.' }),
    // Cost snapshot — null when the variant has no cost profile attached.
    unitCostSnapshotNet: z.string().nullable().openapi({ description: 'Decimal string.' }),
    unitCostSnapshotVatRate: z.string().nullable(),
    unitCostSnapshotVatAmount: z.string().nullable(),
    // Komisyon Faturası anchor (Sale satırı yazdığında set'lenir).
    commissionInvoiceSerialNumber: z.string().nullable().openapi({ example: 'DCF2024000123' }),
    barcode: z.string().nullable().openapi({
      description:
        'Vendor barcode on the order line — the only product trace while productVariantId is null (unmatched line).',
      example: '8680000000001',
    }),
    variant: OrderItemVariantSchema.nullable().openapi({
      description:
        'Joined product variant data. Null while the line is unmatched (variant-resolution links it).',
    }),
  })
  .openapi('OrderItemDetail');

const OrderFeeDetailSchema = z
  .object({
    id: z.string().uuid(),
    feeType: OrderFeeTypeSchema,
    source: OrderFeeSourceSchema,
    direction: OrderFeeDirectionSchema,
    amountNet: z.string().openapi({ description: 'Decimal string.' }),
    vatRate: z.string().openapi({ description: 'Decimal string %.' }),
    vatAmount: z.string().openapi({ description: 'Decimal string.' }),
    displayName: z.string().nullable().openapi({ example: 'Hizmet Bedeli (PSF)' }),
    capturedAt: z.string().datetime(),
    confirmedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({
        description:
          'When the row transitioned from ESTIMATE to its SETTLEMENT pair. PaymentOrder entry ' +
          'triggers this for PSF/STOPPAGE. Null for un-confirmed ESTIMATE rows.',
      }),
  })
  .openapi('OrderFeeDetail');

const OrderClaimItemDetailSchema = z
  .object({
    id: z.string().uuid(),
    orderItemId: z.string().uuid().nullable(),
    reasonCode: z.string().openapi({ example: 'DAMAGEDITEM' }),
    reasonName: z.string().openapi({ example: 'Üründe hasar var' }),
    status: z.string(),
    acceptedBySeller: z.boolean(),
    resolved: z.boolean(),
  })
  .openapi('OrderClaimItemDetail');

const OrderClaimDetailSchema = z
  .object({
    id: z.string().uuid(),
    trendyolClaimId: z.string(),
    claimDate: z.string().datetime(),
    cargoProviderName: z.string().nullable(),
    cargoTrackingNumber: z
      .string()
      .nullable()
      .openapi({
        description:
          'Cargo tracking number rendered as a string — original DB column is BigInt because ' +
          'Trendyol numbers exceed JS safe-integer range.',
      }),
    resolved: z.boolean(),
    items: z.array(OrderClaimItemDetailSchema),
  })
  .openapi('OrderClaimDetail');

const OrderStoreSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    platform: PlatformSchema,
  })
  .openapi('OrderStoreSummary');

// ─── Detail: top-level ────────────────────────────────────────────────────

export const OrderDetailSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    storeId: z.string().uuid(),
    store: OrderStoreSummarySchema,

    platformOrderId: z.string(),
    platformOrderNumber: z.string().nullable(),

    orderDate: z.string().datetime(),
    status: OrderStatusSchema,

    agreedDeliveryDate: z.string().datetime().nullable(),
    actualDeliveryDate: z.string().datetime().nullable(),
    deliveredOnTime: z.boolean().nullable(),
    fastDelivery: z.boolean(),
    micro: z.boolean(),

    saleSubtotalNet: z.string().nullable(),
    saleVatTotal: z.string().nullable(),
    estimatedNetProfit: z.string().nullable(),
    settledNetProfit: z.string().nullable(),

    profitExcludedAt: z
      .string()
      .datetime()
      .nullable()
      .openapi({
        description:
          'Set when the order is permanently outside the profit universe (cost window missed). ' +
          'Irreversible — enforced by a DB trigger (spec 2026-06-12).',
        example: null,
      }),
    profitExclusionReason: z.enum(ProfitExclusionReason).nullable().openapi({
      description: 'Why the order left the profit universe. Paired with profitExcludedAt.',
      example: null,
    }),

    reconciliationStatus: ReconciliationStatusSchema,
    paymentOrderId: z.string().nullable().openapi({
      description: 'PaymentOrder cycle id (BigInt → string). Null until reconciliation closes.',
    }),
    paymentDate: z.string().datetime().nullable(),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),

    items: z.array(OrderItemDetailSchema),
    fees: z.array(OrderFeeDetailSchema).openapi({
      description: 'Chronologically ordered (capturedAt asc). Renders as the fee timeline.',
    }),
    claims: z.array(OrderClaimDetailSchema).openapi({
      description: 'Return claims, synced from Trendyol getClaims by the CLAIMS worker (6h).',
    }),
  })
  .openapi('OrderDetail');

export type OrderDetailResponse = z.infer<typeof OrderDetailSchema>;

// Per-item late cost entry (Slice C) was REMOVED by spec 2026-06-12 (decision
// K2): the only cost window is the order's business day. Orders persist either
// CALCULATED or permanently profit-EXCLUDED — there is no later entry path.
