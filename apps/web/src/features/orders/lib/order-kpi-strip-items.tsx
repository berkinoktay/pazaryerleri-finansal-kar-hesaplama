import { type useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { type StatStripItem } from '@/components/patterns/stat-strip';
import { formatPercentDisplay } from '@/lib/format-percent';

import { type OrderDetail } from '../api/get-order.api';

/** The exact OrderDetail subset the KPI strip reads (mirrors OrderKpiGrid). */
type OrderKpiSource = Pick<
  OrderDetail,
  | 'saleGross'
  | 'estimatedNetProfit'
  | 'settledNetProfit'
  | 'profitBreakdown'
  | 'reconciliationStatus'
>;

/** Translator scoped to the `orderDetail.kpis` namespace (next-intl typed keys). */
type KpiTranslator = ReturnType<typeof useTranslations<'orderDetail.kpis'>>;

/**
 * Builds the four order-detail KPI cells for a bare `StatStrip` docked in the
 * framed `PageHeader` summary slot on the PAGE chrome. Same content/i18n as
 * `OrderKpiGrid` (which the MODAL chrome keeps using): net sale, estimated and
 * settled net profit, and the margin.
 *
 * **Hiçbir finansal değer frontend'de hesaplanmaz** (feedback_no_frontend_financial_calculation):
 * her değer backend-servisli (`profitBreakdown.saleGross` / `.saleMarginPct`,
 * `estimatedNetProfit`, `settledNetProfit`) — burada SADECE render edilir.
 * Satış KPI net satış (iade düşülmüş); breakdown yoksa (profit-excluded) ham
 * `saleGross`'a düşer. Fiili kâr alt-metni yazılmadıysa mutabakat DURUMUNU
 * yansıtır (`PARTIALLY_SETTLED` → kısmi, aksi halde beklemede).
 *
 * @param order backend-served order detail subset
 * @param t translator scoped to `orderDetail.kpis`
 */
export function buildOrderKpiStripItems(order: OrderKpiSource, t: KpiTranslator): StatStripItem[] {
  const netSaleGross = order.profitBreakdown?.saleGross ?? order.saleGross;
  const estimatedProfit = order.estimatedNetProfit;
  const settledProfit = order.settledNetProfit;
  const marginPct = order.profitBreakdown?.saleMarginPct ?? null;

  const settledContext =
    settledProfit !== null
      ? t('settledNetProfit.hint')
      : order.reconciliationStatus === 'PARTIALLY_SETTLED'
        ? t('settledNetProfit.partial')
        : t('settledNetProfit.pending');

  return [
    {
      label: t('saleGross.label'),
      value: <Currency value={netSaleGross ?? '0'} animate />,
      context: netSaleGross === null ? t('common.notAvailable') : undefined,
    },
    {
      label: t('estimatedNetProfit.label'),
      value: <Currency value={estimatedProfit ?? '0'} animate />,
      context: estimatedProfit === null ? t('common.notAvailable') : t('estimatedNetProfit.hint'),
    },
    {
      label: t('settledNetProfit.label'),
      value: <Currency value={settledProfit ?? '0'} animate />,
      context: settledContext,
    },
    {
      label: t('margin.label'),
      value: formatPercentDisplay(marginPct),
      context:
        marginPct === null
          ? t('common.notAvailable')
          : settledProfit !== null
            ? t('margin.basisSettled')
            : t('margin.basisEstimated'),
    },
  ];
}
