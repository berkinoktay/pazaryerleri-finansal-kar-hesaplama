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
    netProfitToday: z.string().openapi({ example: '3220.00' }),
    netProfitYesterday: z.string().openapi({ example: '2875.00' }),
    marginToday: z.string().openapi({
      description: 'Net profit ÷ costed revenue × 100, decimal string',
      example: '25.86',
    }),
    marginYesterday: z.string().openapi({ example: '25.43' }),
    profitCostRatioToday: z.string().openapi({
      description: 'Net profit ÷ costed cost × 100, decimal string',
      example: '38.40',
    }),
    profitCostRatioYesterday: z.string().openapi({ example: '37.10' }),
    // ── Pending gap (today only: universe − costed) — drives the profit-card hint ──
    pendingRevenueToday: z.string().openapi({
      description: "Today's revenue counted but not yet costed, decimal string",
      example: '1860.00',
    }),
    pendingOrderCountToday: z.number().int().nonnegative().openapi({ example: 4 }),
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
  unitCost: z.string().nullable().openapi({
    description:
      'Costed net unit cost (from the order-item snapshot), Decimal string; null when cost-missing',
    example: '42.00',
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
});

export const LivePerformanceTodayProductsSchema = z
  .object({
    data: z.array(TodayProductRowSchema),
  })
  .openapi('LivePerformanceTodayProducts');

const LiveOrderRowSchema = z.object({
  source: z.enum(['orders', 'buffer']).openapi({
    description: '"orders" = fully calculated; "buffer" = cost-missing, awaiting cost entry',
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
  profit: z.string().nullable().openapi({ description: 'Decimal string, null for buffer rows' }),
  margin: z.string().nullable().openapi({ description: 'Decimal string, null for buffer rows' }),
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

export const liveOrdersQuerySchema = z.object({
  filter: z
    .enum(['all', 'calculated', 'pending'])
    .optional()
    .openapi({
      param: { name: 'filter', in: 'query' },
      description: 'Tab filter — all (default), calculated (orders), or pending (buffer)',
    }),
});

export const LivePerformanceOrdersSchema = z
  .object({
    data: z.array(LiveOrderRowSchema),
    total: z.number().int().nonnegative(),
    counts: z.object({
      all: z.number().int().nonnegative(),
      calculated: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
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
    status: z.enum(OrderStatus).nullable().openapi({
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
