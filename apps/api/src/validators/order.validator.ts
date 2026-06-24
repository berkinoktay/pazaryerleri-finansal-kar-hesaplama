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
 * Sort keys for the orders list. The default (`-orderDate`) preserves the
 * historical fixed ordering (newest first). `marginPct` / `-marginPct` order by
 * `Order.estimatedSaleMarginPct` — the only user-sortable column on the table.
 * Margin is `coalesce(settled, estimated)` on the wire, but sorting by a single
 * representative column (the write-once estimate) keeps the ORDER BY stable and
 * index-friendly; the settled value is a small per-order delta, so the estimate
 * is a faithful ordering proxy.
 */
export const ORDER_LIST_SORTS = ['-orderDate', 'marginPct', '-marginPct'] as const;
export type OrderListSort = (typeof ORDER_LIST_SORTS)[number];

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
  lossOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({
      description:
        'When true, return only orders whose consumed net profit ' +
        '(settledNetProfit ?? estimatedNetProfit) is negative ("sadece zararlı").',
      example: 'true',
    }),
  sort: z
    .enum(ORDER_LIST_SORTS)
    .default('-orderDate')
    .openapi({
      description:
        'Sort key. Default `-orderDate` (newest first). `marginPct` / `-marginPct` order by ' +
        'Order.estimatedSaleMarginPct (the sale-margin column on the table) ascending / ' +
        'descending; null margins sort last in both directions.',
      example: '-marginPct',
    }),
}).openapi('ListOrdersQuery');

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// Summary (KPI) shares the list filters but not pagination/sort.
export type OrderSummaryQuery = Omit<ListOrdersQuery, 'page' | 'perPage' | 'sort'>;

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
    // GROSS konvansiyon (2026-06-16): saleSubtotalNet/saleVatTotal → saleGross/saleVat.
    // saleGross = satış toplamı (KDV-dahil), saleVat = içindeki KDV, listGross =
    // liste fiyatı (KDV-dahil). null: OrderItem'lar henüz senkronlanmadı.
    saleGross: z.string().nullable().openapi({
      description:
        'Net sale incl. VAT (decimal string): gross sale minus resolved return deductions (matches the detail modal). null until OrderItems are synced.',
      example: '299.40',
    }),
    saleVat: z.string().nullable().openapi({
      description: 'KDV contained in the gross sale (decimal string).',
      example: '49.90',
    }),
    listGross: z.string().nullable().openapi({
      description: 'List price incl. VAT (decimal string) = saleGross + sellerDiscountGross.',
      example: '349.40',
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
    // Marj backend'de hesaplanıp persist edilir (estimatedSaleMarginPct /
    // settledSaleMarginPct). Wire'a consumed değer servis edilir: settled ?? estimated
    // (settled varsa hakediş gerçeği, yoksa T+0 tahmini). Frontend SADECE render eder
    // (% glyph'i salt gösterim) — türetmez. null: marj henüz hesaplanmadı / payda 0.
    saleMarginPct: z
      .string()
      .nullable()
      .openapi({
        description:
          'Sale margin % (decimal string) = settledSaleMarginPct ?? estimatedSaleMarginPct. ' +
          'Net profit / gross sale × 100. Null until computed or when the gross sale is 0.',
        example: '15.50',
      }),
    // ROI = kâr / Σ maliyet brüt × 100 (consumed: settled ?? estimated). Frontend
    // SADECE render eder (% glyph'i salt gösterim) — türetmez. null: maliyet brüt 0.
    costMarkupPct: z
      .string()
      .nullable()
      .openapi({
        description:
          'Cost markup % (ROI, decimal string) = settledCostMarkupPct ?? estimatedCostMarkupPct. ' +
          'Net profit / total cost gross × 100. Null until computed or when total cost is 0.',
        example: '38.40',
      }),
    // Promosyon gösterimi (spec ekleme #3): mapper'ın yakaladığı satıcı-indirimi
    // promosyon isimleri + brüt tutarları. İndirim/promosyon yoksa null. Liste
    // satırında indirimli siparişin promosyon adı küçük bir rozet/tooltip ile
    // gösterilir (frontend türetmez, render eder) — detaydaki kâr dökümüyle aynı veri.
    promotionDisplays: z
      .array(
        z.object({
          displayName: z.string().openapi({ example: 'Satıcı İndirimi' }),
          amountGross: z.string().openapi({ example: '48.01' }),
        }),
      )
      .nullable()
      .openapi({
        description:
          'Seller-discount promotion names + gross amounts captured at order intake. ' +
          'Null when there is no promotion/discount.',
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

// ─── Summary (KPI) ────────────────────────────────────────────────────────

export const OrderSummaryResponseSchema = z
  .object({
    totalRevenueGross: z.string().openapi({
      description: 'Σ net sale (return-adjusted, KDV-dahil) over the filtered set.',
    }),
    netProfitGross: z
      .string()
      .openapi({ description: 'Σ consumed net profit (settledNetProfit ?? estimatedNetProfit).' }),
    avgMarginPct: z.string().nullable().openapi({
      description: 'Average consumed sale margin % (decimal string); null when no scored orders.',
    }),
    lossOrderRate: z
      .object({
        lossCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
        pct: z.string().openapi({ description: 'lossCount / totalCount × 100 (decimal string).' }),
      })
      .openapi({ description: 'Share of filtered orders whose consumed net profit is negative.' }),
  })
  .openapi('OrderSummaryResponse');

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
    // GROSS konvansiyon (2026-06-16): tüm para değerleri KDV-dahil; net türetilir
    // (gross × 100/(100+rate)). Satır toplamlarıdır (×quantity), birim değil.
    // Satış (gross + KDV oranı).
    lineSaleGross: z
      .string()
      .openapi({ description: 'Line sale total incl. VAT (decimal string).' }),
    saleVatRate: z.string().openapi({ description: 'Sale VAT rate %, decimal string.' }),
    lineSellerDiscountGross: z
      .string()
      .openapi({ description: 'Seller discount incl. VAT (decimal string).' }),
    // Komisyon (gross + oran) — always present (default 0 in schema).
    commissionGross: z.string().openapi({ description: 'Commission incl. VAT (decimal string).' }),
    commissionVatRate: z
      .string()
      .openapi({ description: 'Commission VAT rate %, decimal string.' }),
    refundedCommissionGross: z
      .string()
      .openapi({ description: 'Refunded commission incl. VAT (decimal string).' }),
    estimatedCommissionGross: z
      .string()
      .nullable()
      .openapi({ description: 'T+0 commission estimate (write-once); null pre-estimate.' }),
    settledCommissionGross: z
      .string()
      .nullable()
      .openapi({ description: 'Settlement commission (mutable); null pre-settlement.' }),
    // Cost snapshot (gross + VAT rate) — null when the variant has no cost profile attached.
    unitCostSnapshotGross: z
      .string()
      .nullable()
      .openapi({ description: 'Unit cost snapshot incl. VAT (decimal string).' }),
    unitCostSnapshotVatRate: z.string().nullable(),
    // Komisyon Faturası anchor (Sale satırı yazdığında set'lenir).
    commissionInvoiceSerialNumber: z.string().nullable().openapi({ example: 'DCF2024000123' }),
    barcode: z.string().nullable().openapi({
      description:
        'Vendor barcode on the order line — the only product trace while productVariantId is null (unmatched line).',
      example: '8680000000001',
    }),
    vendorMissing: z.boolean().openapi({
      description:
        'Unmatched line whose barcode is confirmed absent from the Trendyol approved catalog ' +
        '(CatalogBarcodeMiss.vendorMissing). Drives the "Trendyol kataloğunda yok" badge instead ' +
        'of "eşleşme bekliyor". Only meaningful for unmatched lines (variant null); always false ' +
        'for matched lines.',
      example: false,
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
    // GROSS konvansiyon (2026-06-16): amountNet+vatAmount → amountGross+vatRate.
    // net türetilir (amountGross × 100/(100+vatRate)). isEstimate = source==='ESTIMATE'
    // → tahmin/gerçek-fatura rozetini frontend bu boolean'dan çizer (türetmez).
    amountGross: z.string().openapi({ description: 'Fee amount incl. VAT (decimal string).' }),
    vatRate: z.string().openapi({ description: 'VAT rate %, decimal string.' }),
    isEstimate: z.boolean().openapi({
      description:
        'True when the row is a deterministic T+0 ESTIMATE (not yet confirmed by a vendor ' +
        'settlement/invoice). Drives the "Tahmini" vs "Gerçek fatura" badge.',
    }),
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

// ─── Kâr dökümü (backend-hesaplı, frontend türetmez) ──────────────────────
// Berkin'in otoritatif formülü: Satış − Maliyet − Komisyon − Kargo − PSF −
// Stopaj − Net KDV = Kâr. Brüt (KDV-dahil) terimler + Net KDV; tüm değer Decimal
// string. netProfit/netVat persist'ten (computeProfit), brüt toplamlar
// buildProfitBreakdown'dan. profit-excluded / maliyet-eksik siparişte null.
const ProfitBreakdownSchema = z
  .object({
    listGross: z
      .string()
      .openapi({ description: 'Liste fiyatı brüt = satış brüt + satıcı indirimi brüt.' }),
    sellerDiscountGross: z
      .string()
      .openapi({ description: "Satıcı indirimi brüt (≥0). '0.00' → indirim yok." }),
    saleGross: z
      .string()
      .openapi({ description: 'Satış brüt (effectiveSale = liste − indirim, KDV-dahil).' }),
    saleVat: z.string(),
    costGross: z.string(),
    costVat: z.string(),
    commissionGross: z.string(),
    commissionVat: z.string(),
    shippingGross: z.string(),
    shippingVat: z.string(),
    outboundShippingGross: z.string().openapi({
      description:
        'Gidiş (forward) kargo brüt — kargo collapsible alt satırı. shippingGross = outbound + return.',
    }),
    outboundShippingVat: z.string(),
    returnShippingGross: z.string().openapi({
      description: "İade (return) kargo brüt. '0.00' → iade kargosu yok.",
    }),
    returnShippingVat: z.string(),
    platformServiceGross: z.string(),
    platformServiceVat: z.string(),
    stoppage: z.string().openapi({
      description:
        'Stopaj (kaynakta kesinti) — ayrı düşülen brüt terim, KDV-siz (vatRate 0). ' +
        'Net KDV içine katlanmaz; kârdan doğrudan düşülür.',
    }),
    netVat: z.string().openapi({
      description: 'Net KDV = Satış KDV − Maliyet KDV − Komisyon KDV − Kargo KDV − PSF KDV.',
    }),
    netProfit: z.string(),
    // Marjlar persist'ten okunur (estimatedSaleMarginPct/estimatedCostMarkupPct);
    // null: payda 0 (saleGross=0 ya da Σ costGross=0). Frontend türetmez, render eder.
    saleMarginPct: z
      .string()
      .nullable()
      .openapi({ description: 'Kâr / satış brüt × 100. null: satış brüt 0.' }),
    costMarkupPct: z
      .string()
      .nullable()
      .openapi({ description: 'Kâr / Σ maliyet brüt × 100. null: maliyet brüt 0.' }),
  })
  .openapi('ProfitBreakdown');

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

    // GROSS konvansiyon (2026-06-16): saleSubtotalNet/saleVatTotal → saleGross/saleVat/listGross.
    saleGross: z.string().nullable(),
    saleVat: z.string().nullable(),
    listGross: z.string().nullable(),
    estimatedNetProfit: z.string().nullable(),
    settledNetProfit: z.string().nullable(),
    // Backend-hesaplı kâr dökümü (tahmini basis). Kârın gösterildiği her yüzeyde
    // AYNI bileşene servis edilir; frontend hiçbir finansal değeri türetmez.
    // null: profit-excluded ya da maliyet snapshot eksik (estimate hesaplanmadı).
    profitBreakdown: ProfitBreakdownSchema.nullable(),

    // Promosyon gösterimi (spec ekleme #3): mapper'ın yakaladığı satıcı-indirimi
    // promosyon isimleri + brüt tutarları. İndirim/promosyon yoksa null. Frontend
    // indirim satırının yanında promosyon adını gösterir (türetmez, render eder).
    promotionDisplays: z
      .array(
        z.object({
          displayName: z.string().openapi({ example: 'Satıcı İndirimi' }),
          amountGross: z.string().openapi({ example: '48.01' }),
        }),
      )
      .nullable()
      .openapi({
        description:
          'Seller-discount promotion names + gross amounts captured at order intake. ' +
          'Null when there is no promotion/discount.',
      }),

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
