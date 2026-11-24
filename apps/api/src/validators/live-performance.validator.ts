import { z } from '@hono/zod-openapi';

import { OrderStatus } from '@pazarsync/db/enums';

// All monetary values are Decimal strings (services preserve precision via
// decimal.js + toFixed(2)); the frontend re-parses with decimal.js. Never floats.

export const LivePerformanceKpisSchema = z
  .object({
    // ── Volume (whole today-universe = orders ∪ today-buffer; yesterday = orders) ──
    revenueToday: z.string().openapi({ description: 'Decimal string', example: '12450.00' }),
    revenueYesterday: z.string().openapi({ example: '11530.00' }),
    orderCountToday: z.number().int().nonnegative().openapi({ example: 87 }),
    orderCountYesterday: z.number().int().nonnegative().openapi({ example: 80 }),
    unitsSoldToday: z
      .number()
      .int()
      .nonnegative()
      .openapi({ description: 'Σ line quantity across the universe', example: 134 }),
    unitsSoldYesterday: z.number().int().nonnegative().openapi({ example: 121 }),
    // ── Profit family (costed subset = orders with non-null estimatedNetProfit) ──
    netProfitToday: z.string().openapi({
      description:
        "Net profit (decimal string) over today's orders whose estimate is computed - stored, " +
        'or computed in the request while the statement is not written yet; cost-pending ' +
        'orders do not contribute.',
      example: '3220.00',
    }),
    netProfitYesterday: z
      .string()
      .nullable()
      .openapi({
        description:
          "Net profit (decimal string) over yesterday's orders whose estimate profit statement is " +
          'computed; null when no costed order.',
        example: '2875.00',
      }),
    marginToday: z
      .string()
      .nullable()
      .openapi({
        description:
          "Net profit / costed sale * 100 (decimal string), over today's orders whose estimate " +
          "is computed; the sale is the estimate's own (after any return). Null when no costed " +
          'order.',
        example: '25.86',
      }),
    marginYesterday: z.string().nullable().openapi({
      description: "Yesterday's margin, as marginToday; null when no costed order.",
      example: '25.43',
    }),
    profitCostRatioToday: z
      .string()
      .nullable()
      .openapi({
        description:
          "Net profit / costed cost * 100 (decimal string), over today's orders whose estimate " +
          'is computed. Null when no costed order.',
        example: '38.40',
      }),
    profitCostRatioYesterday: z.string().nullable().openapi({
      description:
        "Yesterday's profit/cost ratio, as profitCostRatioToday; null when no costed order.",
      example: '37.10',
    }),
    // ── Pending gap (today only: universe − costed) — drives the profit-card hint ──
    pendingRevenueToday: z.string().openapi({
      description: "Today's revenue counted but not yet costed, decimal string",
      example: '1860.00',
    }),
    pendingOrderCountToday: z
      .number()
      .int()
      .nonnegative()
      .openapi({
        description:
          "Count of today's orders without a computed estimate - cost still missing in the buffer, " +
          'or not computable yet.',
        example: 4,
      }),
  })
  .openapi('LivePerformanceKpis');

const HourlyPointSchema = z.object({
  hour: z.number().int().min(0).max(23).openapi({ example: 14 }),
  cumulativeRevenue: z.string().openapi({ description: 'Decimal string', example: '8400.00' }),
  cumulativeProfit: z.string().openapi({ description: 'Decimal string', example: '1820.00' }),
});

export const LivePerformanceChartSchema = z
  .object({
    today: z.array(HourlyPointSchema),
    yesterday: z.array(HourlyPointSchema),
  })
  .openapi('LivePerformanceChart');

// The variant desi fields of a live-performance row, defined once for the today
// products row and the buffer detail line. Same meaning as VariantSummary's fields
// (product.validator.ts), produced by the same toVariantDesiFields rule.
const LIVE_DESI_FIELDS = {
  dimensionalWeight: z
    .string()
    .nullable()
    .openapi({
      description:
        'Effective desi (decimal string): the seller override, else the marketplace desi. ' +
        'Null when the variant has neither, and on a row whose barcode resolves to no variant. ' +
        'A seller override is at least 1.',
      example: '1.5',
    }),
  syncedDimensionalWeight: z
    .string()
    .nullable()
    .openapi({
      description:
        'The last known marketplace desi (decimal string); a sync without a desi keeps it. ' +
        'Null when the marketplace never sent one, and on a row whose barcode resolves to no ' +
        'variant.',
      example: '1.2',
    }),
  isDimensionalWeightOverridden: z.boolean().openapi({
    description:
      'True when the seller entered a desi. False on a row whose barcode resolves to no variant.',
    example: false,
  }),
  isDimensionalWeightMissing: z.boolean().openapi({
    description:
      'True when a non-digital variant has no seller desi and no marketplace desi (same rule ' +
      'as VariantSummary.isDimensionalWeightMissing). Any stored desi is not missing; a ' +
      'digital variant needs none. False on a row whose barcode resolves to no variant.',
    example: false,
  }),
};

const TodayProductRowSchema = z.object({
  variantId: z.string().uuid().nullable().openapi({
    description: 'Catalog variant id; null on an unresolved (barcode-fallback) row.',
  }),
  barcode: z.string().openapi({ example: '8680000000001' }),
  stockCode: z.string().nullable().openapi({
    description: "Seller's stock code (SKU); null when unresolved",
    example: 'TS-BEYAZ-M',
  }),
  productName: z
    .string()
    .nullable()
    .openapi({ description: 'Null when unresolved', example: 'Pamuklu Tişört Beyaz M' }),
  thumbUrl: z.string().nullable().openapi({ description: 'Product image URL or null' }),
  orderCount: z.number().int().nonnegative().openapi({
    description: 'Distinct orders + buffer entries containing this product today',
    example: 5,
  }),
  unitsSold: z.number().int().nonnegative().openapi({
    description: 'Sum of line quantity across orders + buffer',
    example: 8,
  }),
  revenue: z.string().openapi({
    description: 'Σ line revenue (unit price net × qty) over orders + buffer, Decimal string',
    example: '3600.00',
  }),
  costStatus: z.enum(['costed', 'missing']).openapi({
    description: "'costed' = variant has an active cost profile; 'missing' = needs a cost",
    example: 'costed',
  }),
  currentCostTry: z
    .string()
    .nullable()
    .openapi({
      description:
        'Live TL sum of all active cost profiles (VAT included, per unit): the cost that ' +
        "today's orders of this variant carry until the day ends. Null when profileCount is 0. " +
        'Decimal string.',
      example: '42.00',
    }),
  profileCount: z
    .number()
    .int()
    .nonnegative()
    .openapi({
      description:
        'Number of active (non-archived) cost profiles attached to this variant. 0 on an ' +
        'unresolved row.',
      example: 1,
    }),
  unresolved: z.boolean().openapi({
    description:
      'Barcode resolves to no catalog variant — identity falls back to the raw barcode; ' +
      'rare after eager repair (spec 2026-06-12 §7).',
    example: false,
  }),
  vendorMissing: z.boolean().openapi({
    description:
      'Unresolved barcode confirmed absent from the Trendyol approved catalog ' +
      '(CatalogBarcodeMiss.vendorMissing). Drives the "Trendyol kataloğunda yok" badge ' +
      'instead of "eşleşme bekliyor". Only meaningful when unresolved; always false otherwise.',
    example: false,
  }),
  ...LIVE_DESI_FIELDS,
});

export const LivePerformanceTodayProductsSchema = z
  .object({
    data: z.array(TodayProductRowSchema),
  })
  .openapi('LivePerformanceTodayProducts');

const LiveOrderRowSchema = z.object({
  source: z.enum(['orders', 'buffer']).openapi({
    description:
      '"orders" = an orders-table row (calculated when its estimate is computed, pending ' +
      'otherwise); "buffer" = cost-missing, awaiting cost entry',
  }),
  platformOrderId: z.string(),
  platformOrderNumber: z.string().nullable(),
  orderId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: 'Order.id for source="orders" rows; null for buffer rows' }),
  bufferId: z.string().uuid().nullable().openapi({
    description: 'LivePerformanceBuffer.id for source="buffer" rows; null for order rows',
  }),
  orderDate: z.string().datetime(),
  status: z.string(),
  revenue: z.string().openapi({ description: 'Decimal string' }),
  profit: z
    .string()
    .nullable()
    .openapi({
      description:
        'Net profit (decimal string); null for buffer rows, for cancelled orders and for orders ' +
        'whose estimate profit statement is not yet computed.',
    }),
  margin: z
    .string()
    .nullable()
    .openapi({
      description:
        'Sale margin % (decimal string); null for buffer rows, for cancelled orders and for ' +
        'orders whose estimate profit statement is not yet computed.',
    }),
  // Promosyon gösterimi (spec ekleme #3): indirimli siparişin promosyon adları +
  // brüt tutarları. İndirim/promosyon yoksa null. Buffer satırlarında her zaman null
  // (mapped payload promosyon taşımaz). Frontend rozet/tooltip ile render eder.
  promotionDisplays: z
    .array(
      z.object({
        displayName: z.string().openapi({ example: 'Satıcı İndirimi' }),
        amountGross: z.string().openapi({ example: '48.01' }),
      }),
    )
    .nullable()
    .openapi({
      description: 'Seller-discount promotion names + gross amounts. Null when none / buffer rows.',
    }),
});

/** Tabs of the live orders feed; `cancelled` is never part of `all`. */
export const LIVE_ORDERS_FILTERS = ['all', 'calculated', 'pending', 'cancelled'] as const;
export type LiveOrdersFilter = (typeof LIVE_ORDERS_FILTERS)[number];

export const liveOrdersQuerySchema = z.object({
  filter: z
    .enum(LIVE_ORDERS_FILTERS)
    .optional()
    .openapi({
      param: { name: 'filter', in: 'query' },
      description:
        'Tab filter — all (default), calculated (orders whose estimate is computed), ' +
        "pending (buffer + orders whose estimate is not computed), or cancelled (today's " +
        'cancelled orders, which all, calculated and pending never include)',
    }),
});

export const LivePerformanceOrdersSchema = z
  .object({
    data: z.array(LiveOrderRowSchema),
    total: z.number().int().nonnegative(),
    counts: z.object({
      all: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: 'calculated + pending; cancelled orders are not counted' }),
      calculated: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      cancelled: z
        .number()
        .int()
        .nonnegative()
        .openapi({ description: "Today's cancelled orders of the store" }),
    }),
  })
  .openapi('LivePerformanceOrders');

const BufferDetailLineSchema = z.object({
  barcode: z.string().openapi({ example: '8680000000001' }),
  productName: z
    .string()
    .openapi({ description: 'Product title, or the barcode when the variant is unresolved' }),
  thumbUrl: z.string().nullable().openapi({ description: 'Product image URL or null' }),
  variantId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: 'ProductVariant.id when the barcode resolves; null otherwise' }),
  stockCode: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
  // GROSS konvansiyon (2026-06-16): lineSaleGross satır toplamı (KDV-dahil, × quantity).
  lineSaleGross: z.string().openapi({ description: 'Line sale total incl. VAT (decimal string)' }),
  isCostMissing: z.boolean().openapi({
    description:
      "The line's gap in the calculability gate that holds the order: no cost profile linked, " +
      "or every linked cost profile is archived (not in force at the order's business-day end), " +
      'or the barcode resolves to no variant.',
    example: false,
  }),
  ...LIVE_DESI_FIELDS,
});

export const BufferDetailSchema = z
  .object({
    platformOrderNumber: z.string().nullable(),
    orderDate: z.string().datetime(),
    status: z.string(),
    saleGross: z.string().openapi({ description: 'Sale total incl. VAT (decimal string)' }),
    lines: z.array(BufferDetailLineSchema),
  })
  .openapi('BufferDetail');

export const notificationSummaryQuerySchema = z.object({
  source: z.enum(['orders', 'buffer']).openapi({
    param: { name: 'source', in: 'query' },
    description: 'Which table the realtime INSERT came from',
  }),
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: 'id', in: 'query' }, description: 'Row id from the INSERT event' }),
});

export const NewOrderNotificationSummarySchema = z
  .object({
    source: z.enum(['orders', 'buffer']),
    orderId: z.string().uuid().nullable(),
    bufferId: z.string().uuid().nullable(),
    platformOrderNumber: z.string().nullable(),
    revenue: z
      .string()
      .openapi({ description: 'Sale subtotal (net), Decimal string', example: '149.90' }),
    profit: z.string().nullable().openapi({
      description: 'Estimated net profit, Decimal string; null when cost is pending',
      example: '38.40',
    }),
    costStatus: z.enum(['costed', 'pending']).openapi({
      description: "'costed' = profit known; 'pending' = cost-missing",
      example: 'pending',
    }),
    isToday: z.boolean().openapi({
      description: "Whether the order falls in today's business day",
      example: true,
    }),
    status: z
      .enum(OrderStatus)
      .nullable()
      .openapi({
        description:
          "Order lifecycle status for source='orders'; null for source='buffer' (a buffer " +
          'entry is not yet an order and cannot be cancelled). Lets the client drop a toast ' +
          'for a CANCELLED / first-seen-RETURNED order.',
        example: 'PROCESSING',
      }),
    isPromotion: z.boolean().openapi({
      description:
        "True when source='orders' and the order graduated from the live-performance " +
        'buffer (promotedFromBufferAt set); always false for buffer entries. Lets the ' +
        'client suppress a duplicate ding for an order the seller already saw.',
      example: false,
    }),
  })
  .openapi('NewOrderNotificationSummary');
