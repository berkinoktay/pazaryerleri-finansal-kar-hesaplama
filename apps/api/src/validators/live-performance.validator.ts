import { z } from '@hono/zod-openapi';

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

const MissingCostRowSchema = z.object({
  variantId: z.string().uuid(),
  barcode: z.string().openapi({ example: '8680000000001' }),
  stockCode: z
    .string()
    .openapi({ description: "Seller's stock code (SKU)", example: 'TS-BEYAZ-M' }),
  productName: z.string().openapi({ example: 'Pamuklu Tişört Beyaz M' }),
  thumbUrl: z.string().nullable().openapi({ description: 'Product image URL or null' }),
  orderCount: z.number().int().positive().openapi({ example: 3 }),
  revenueImpact: z.string().openapi({ description: 'Decimal string', example: '450.00' }),
});

export const LivePerformanceMissingCostSchema = z
  .object({
    data: z.array(MissingCostRowSchema),
  })
  .openapi('LivePerformanceMissingCost');

const TopProductRowSchema = z.object({
  rank: z.number().int().min(1).max(3).openapi({ example: 1 }),
  variantId: z.string().uuid(),
  productName: z.string().openapi({ example: 'Pamuklu Tişört Beyaz M' }),
  thumbUrl: z.string().nullable().openapi({ description: 'Product image URL or null' }),
  orderCount: z.number().int().positive().openapi({ example: 12 }),
  revenue: z.string().openapi({ description: 'Decimal string', example: '3600.00' }),
  profit: z
    .string()
    .nullable()
    .openapi({ description: 'Decimal string, null if any contributing order is cost-missing' }),
});

export const LivePerformanceTopProductsSchema = z
  .object({
    data: z.array(TopProductRowSchema),
  })
  .openapi('LivePerformanceTopProducts');

const LiveOrderRowSchema = z.object({
  source: z.enum(['orders', 'buffer']).openapi({
    description: '"orders" = fully calculated; "buffer" = cost-missing, awaiting cost entry',
  }),
  platformOrderId: z.string(),
  platformOrderNumber: z.string().nullable(),
  orderDate: z.string().datetime(),
  status: z.string(),
  revenue: z.string().openapi({ description: 'Decimal string' }),
  profit: z.string().nullable().openapi({ description: 'Decimal string, null for buffer rows' }),
  margin: z.string().nullable().openapi({ description: 'Decimal string, null for buffer rows' }),
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
