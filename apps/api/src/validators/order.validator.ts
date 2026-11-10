import { z } from '@hono/zod-openapi';

import {
  OrderFeeDirection,
  OrderFeeSource,
  OrderFeeType,
  OrderStatus,
  Platform,
  ProfitExclusionReason,
  ProfitIssueCode,
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
    "Settlement progression, read from the order's best-known profit statement; NOT_SETTLED when " +
    'the order has no statement yet. NOT_SETTLED = no settlement applied, PARTIALLY_SETTLED = ' +
    'settlement started, FULLY_SETTLED = settlement fully reconciled.',
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
 * the best-known profit statement's sale margin -- the only user-sortable column on
 * the table. Orders that carry a best-known statement sort by that statement's margin
 * (ascending / descending); orders without one sort last in both directions, with the
 * order id as the tiebreaker.
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
        "Filter by profit universe. 'calculated' = orders not excluded from profit " +
        "(profit_excluded_at is null); 'excluded' = orders stamped out of the profit universe " +
        '(profit_excluded_at set, cost window missed - permanent). Omit for all.',
      example: 'excluded',
    }),
  lossOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .openapi({
      description:
        'When true, return only orders whose best-known profit statement reports a net ' +
        'profit below zero.',
      example: 'true',
    }),
  sort: z
    .enum(ORDER_LIST_SORTS)
    .default('-orderDate')
    .openapi({
      description:
        'Sort key. Default `-orderDate` (newest first). `marginPct` / `-marginPct` order by ' +
        "the best-known profit statement's sale margin ascending / descending; orders without " +
        'a statement sort last in both directions, ties broken by id.',
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
    saleGross: z
      .string()
      .nullable()
      .openapi({
        description:
          'Sale incl. VAT (decimal string), read from the best-known profit statement: its sale ' +
          "(gross sale minus sale returns). Falls back to the order's own sale when no statement " +
          'exists yet, 0 for a cancelled order without a statement, and null until OrderItems are synced.',
        example: '299.40',
      }),
    saleVat: z
      .string()
      .nullable()
      .openapi({
        description:
          'VAT contained in saleGross (decimal string), from the same source: the best-known ' +
          "profit statement's output VAT; the order's own sale VAT when no statement exists yet, " +
          '0 for a cancelled order without a statement, and null until OrderItems are synced.',
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
          "Net profit from the order's estimate profit statement (decimal string). Null when the " +
          'estimate cannot be computed, the order is excluded from profit, or the order was ' +
          'cancelled without a penalty (a CANCELLED statement with a zero net profit).',
        example: '78.40',
      }),
    settledNetProfit: z
      .string()
      .nullable()
      .openapi({
        description:
          'Best-known net profit (decimal string) once settlement reconciliation has started for ' +
          'the order; null before any settlement is applied, and null for an order cancelled ' +
          'without a penalty (a CANCELLED statement with a zero net profit).',
        example: '75.10',
      }),
    // Margin is computed and persisted on the best-known profit statement; the wire serves
    // that value. The frontend only renders it (the % glyph is display-only) -- it never
    // derives it. null: no statement yet, or the sale gross denominator is 0.
    saleMarginPct: z
      .string()
      .nullable()
      .openapi({
        description:
          'Sale margin % (decimal string) from the best-known profit statement: net profit / sale ' +
          'gross * 100. Null until a statement exists or when the sale gross is 0.',
        example: '15.50',
      }),
    // ROI = net profit / total cost gross * 100, read from the best-known profit statement.
    // The frontend only renders it (the % glyph is display-only) -- it never derives it.
    // null: the total cost gross denominator is 0 (or no statement yet).
    costMarkupPct: z
      .string()
      .nullable()
      .openapi({
        description:
          'Cost markup % (ROI, decimal string) from the best-known profit statement: net profit / ' +
          'total cost gross * 100. Null until a statement exists or when total cost is 0.',
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
    // Hızlı teslimat SLA sonucu (Bugün Kargoda avantajı): actualDeliveryDate <=
    // agreedDeliveryDate → true (zamanında, avantaj korundu), false → geç (avantaj
    // kaybı). null → henüz teslim edilmedi. fastDelivery ile birlikte SLA rozetini sürer.
    deliveredOnTime: z.boolean().nullable().openapi({
      description: 'Delivery SLA outcome: true on-time, false late, null not delivered yet.',
    }),
    micro: z.boolean(),
    itemCount: z.number().int().nonnegative().openapi({
      description: 'Number of OrderItems on this order.',
      example: 2,
    }),
    // Kâr-dışı bilgisi liste satırında da gerekiyor: "Kâr Hesabı Dışı" sekmesinde
    // her satır kendi dışlanma sebebini + tarihini gösterir (CHECK: ikisi birlikte
    // null ya da birlikte dolu). Hesaplanan siparişlerde her ikisi de null.
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
  })
  .openapi('OrderListItem');

export type OrderListItemResponse = z.infer<typeof OrderListItemSchema>;

export const ListOrdersResponseSchema = z
  .object({
    data: z.array(OrderListItemSchema),
    pagination: TableMetaSchema,
    counts: z
      .object({
        calculated: z.number().int().nonnegative().openapi({
          description: 'Count of orders not excluded from profit (profit_excluded_at is null).',
        }),
        excluded: z.number().int().nonnegative().openapi({
          description: 'Count of profit-excluded orders (profit_excluded_at set - permanent).',
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
      description:
        'Total revenue (sale incl. VAT, decimal string) over the filtered orders, summed from ' +
        'their best-known profit statements; an order with no statement contributes its own sale ' +
        '(a cancelled order contributes nothing). Profit-excluded orders still count toward revenue.',
    }),
    netProfitGross: z.string().openapi({
      description:
        'Total net profit (decimal string) over the filtered orders, summed from their best-known ' +
        'profit statements. Orders excluded from profit never contribute.',
    }),
    avgMarginPct: z
      .string()
      .nullable()
      .openapi({
        description:
          "Average sale margin % (decimal string) across the filtered orders' best-known profit " +
          'statements, rounded to 4 decimals; null when no order has a statement.',
      }),
    lossOrderRate: z
      .object({
        lossCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
        pct: z.string().openapi({ description: 'lossCount / totalCount * 100 (decimal string).' }),
      })
      .openapi({
        description:
          'Share of filtered orders whose best-known profit statement reports a negative net ' +
          'profit. Both counts take the same statements: best-known, with a computed net ' +
          'profit, status not CANCELLED (a cancellation never enters the rate). lossCount ' +
          'is the negative ones, totalCount all of them; a filtered order without such a ' +
          'statement counts in neither.',
      }),
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
    commissionGross: z.string().openapi({
      description:
        "Commission incl. VAT (decimal string), from the order's best-known COMMISSION lines; " +
        "'0.00' when none (e.g. a cancelled order). Falls back to the item's own commission " +
        'column only when the profit part is empty (a platform the engine cannot compute, or a ' +
        'profit read that failed).',
    }),
    commissionRate: z.string().openapi({
      description:
        "Commission rate % (decimal string) from the profit lines; falls back to the item's own " +
        'commission rate column when no line supplies it.',
    }),
    commissionVatRate: z
      .string()
      .openapi({ description: 'Commission VAT rate %, decimal string.' }),
    refundedCommissionGross: z.string().openapi({
      description:
        'Refunded commission incl. VAT (decimal string), from the best-known COMMISSION_REFUND ' +
        "lines; '0.00' when none. Falls back to the item's own column only when the profit " +
        'part is empty (a platform the engine cannot compute, or a profit read that failed).',
    }),
    estimatedCommissionGross: z
      .string()
      .nullable()
      .openapi({
        description:
          'Estimated commission incl. VAT (decimal string) from the estimate profit lines; null ' +
          'when none.',
      }),
    settledCommissionGross: z
      .string()
      .nullable()
      .openapi({
        description:
          'Settled commission incl. VAT (decimal string) from the settlement profit lines; null ' +
          'until settlement.',
      }),
    // Cost snapshot (gross + VAT rate) — null when the variant has no cost profile attached.
    unitCostSnapshotGross: z
      .string()
      .nullable()
      .openapi({
        description:
          "Unit cost incl. VAT (decimal string) from the order's best-known profit lines; '0.00' " +
          'when no cost line exists; null when a MISSING_COST issue covers the item or the profit ' +
          'cannot be computed.',
      }),
    unitCostSnapshotVatRate: z
      .string()
      .nullable()
      .openapi({
        description:
          "Unit cost VAT rate % (decimal string) from the order's best-known profit lines; null when " +
          'no cost line exists.',
      }),
    // Komisyon Faturası anchor (Sale satırı yazdığında set'lenir).
    commissionInvoiceSerialNumber: z
      .string()
      .nullable()
      .openapi({ description: 'Deprecated: always null.', example: 'DCF2024000123' }),
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
// string. netProfit and netVat are read from the best-known profit statement; the gross
// group totals come from buildStatementBreakdown. Null for a profit-excluded or
// cost-missing order.
const ProfitBreakdownSchema = z
  .object({
    listGross: z
      .string()
      .openapi({ description: 'Liste fiyatı brüt = satış brüt + satıcı indirimi brüt.' }),
    sellerDiscountGross: z.string().openapi({
      description:
        "Seller discount incl. VAT (decimal string); '0.00' when there is no discount. May be " +
        'transiently negative while a return record has arrived before its discount reversal. ' +
        'listGross - sellerDiscountGross always equals saleGross.',
    }),
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
    internationalServiceGross: z.string().openapi({
      description:
        'Mikro ihracat Uluslararası Hizmet Bedeli brüt (KDV-dahil). PSF yerine geçer. ' +
        "Normal siparişte '0.00'.",
    }),
    internationalServiceVat: z.string(),
    overseasReturnOperationGross: z.string().openapi({
      description:
        'Mikro ihracat Yurt Dışı İade Operasyon Bedeli brüt. İadede satış reverse ' +
        "ETMEDEN kesilen düz DEBIT ücret. Normal siparişte '0.00'.",
    }),
    overseasReturnOperationVat: z.string(),
    stoppage: z.string().openapi({
      description:
        'Stopaj (kaynakta kesinti) — ayrı düşülen brüt terim, KDV-siz (vatRate 0). ' +
        'Net KDV içine katlanmaz; kârdan doğrudan düşülür.',
    }),
    netVat: z.string().openapi({
      description: 'Net KDV = Satış KDV − Maliyet KDV − Komisyon KDV − Kargo KDV − PSF KDV.',
    }),
    netProfit: z.string(),
    // Margins come from the best-known profit statement (its sale margin / cost markup);
    // null when the denominator is 0 (sale gross 0, or total cost gross 0). The frontend
    // only renders them -- it never derives them.
    saleMarginPct: z
      .string()
      .nullable()
      .openapi({ description: 'Kâr / satış brüt × 100. null: satış brüt 0.' }),
    costMarkupPct: z
      .string()
      .nullable()
      .openapi({ description: 'Kâr / Σ maliyet brüt × 100. null: maliyet brüt 0.' }),
    // Grup toplamları — "satış nereye gitti" gruplu sunumu için kâr motorunda toplanır
    // (frontend finansal toplama yapmaz). costGross + marketplaceFeesGross + taxesGross
    // + netProfit = saleGross.
    marketplaceFeesGross: z.string().openapi({
      description: 'Pazaryeri kesintileri = komisyon + kargo + PSF + mikro ücretler (display).',
    }),
    taxesGross: z.string().openapi({
      description: 'Vergiler = stopaj + Net KDV. Net KDV negatifse grup küçülür.',
    }),
    totalDeductionsGross: z.string().openapi({
      description:
        'Toplam gider = ürün maliyeti + pazaryeri kesintileri + vergiler ( = satış − net kâr ).',
    }),
  })
  .openapi('ProfitBreakdown', {
    description:
      "Profit breakdown built from the order's best-known profit statement and its selected " +
      'profit lines. Null when the order has no net profit to show - not computable, excluded ' +
      'from profit, or the profit could not be computed for this request.',
  });

// A profit issue the engine recorded on the order's best-known statement and that still
// applies to its selected lines. The frontend localizes from `code`; `detail` is English
// context (shown inside the localized copy only for CARRIER_NOT_RECOGNIZED, where it is
// the carrier name Trendyol reported).
const ProfitIssueSchema = z
  .object({
    code: z.enum(ProfitIssueCode).openapi({
      description:
        'Machine-readable issue code. Blocking codes make the profit not computable; the others ' +
        'are warnings shown next to a computed profit.',
      example: 'CARRIER_NOT_RECOGNIZED',
    }),
    orderItemId: z.string().uuid().nullable().openapi({
      description: 'The order item the issue names; null for a parcel-wide issue.',
      example: null,
    }),
    detail: z
      .string()
      .nullable()
      .openapi({
        description:
          'Optional English context for the issue. For CARRIER_NOT_RECOGNIZED it is the ' +
          'carrier name as Trendyol reported it (null when blank) and the frontend shows it ' +
          'inside its localized copy; for every other code it is not user-facing.',
        example: 'Alternative Delivery',
      }),
  })
  .openapi('ProfitIssue');

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
    saleGross: z
      .string()
      .nullable()
      .openapi({
        description:
          'Sale incl. VAT (decimal string), the same value as the orders list row: the best-known ' +
          "statement's sale, the order's own sale when no statement exists, 0 for a cancelled order " +
          'without a statement, null until OrderItems are synced.',
      }),
    saleVat: z
      .string()
      .nullable()
      .openapi({
        description:
          'VAT contained in saleGross (decimal string), matching the orders list row value and ' +
          "source: the best-known statement's output VAT, the order's own sale VAT when no " +
          'statement exists, 0 for a cancelled order without a statement, null until OrderItems ' +
          'are synced.',
      }),
    listGross: z.string().nullable(),
    estimatedNetProfit: z.string().nullable(),
    settledNetProfit: z.string().nullable(),
    // Backend-hesaplı kâr dökümü (tahmini basis). Kârın gösterildiği her yüzeyde
    // AYNI bileşene servis edilir; frontend hiçbir finansal değeri türetmez.
    // null: profit-excluded ya da maliyet snapshot eksik (estimate hesaplanmadı).
    profitBreakdown: ProfitBreakdownSchema.nullable(),
    profitIssues: z.array(ProfitIssueSchema).openapi({
      description:
        "The best-known profit statement's issues that still apply to its selected lines; a " +
        'warning a later actual made moot is left out (CARRIER_NOT_RECOGNIZED once an actual ' +
        'shipping line is selected; SELLER_CARGO_AGREEMENT_ESTIMATE once a cargo invoice replaced ' +
        'every shipping estimate). CARRIER_NOT_RECOGNIZED is also left out while ' +
        'SELLER_CARGO_AGREEMENT_ESTIMATE is returned, since no cargo invoice is coming on such an ' +
        'order. Empty when there are none, and when the profit part is empty (a platform the ' +
        'engine cannot compute, or a profit read that failed).',
    }),

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
      description: 'Deprecated: always null.',
    }),
    paymentDate: z.string().datetime().nullable().openapi({
      description: 'Deprecated: always null.',
    }),

    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),

    items: z.array(OrderItemDetailSchema),
    fees: z.array(OrderFeeDetailSchema).openapi({
      description: 'Deprecated: always an empty array.',
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
