import type { ChartDatum } from '@/components/patterns/chart.types';

/** Which cumulative field a chart series plots — the ciro/kâr toggle. */
export type ChartMetric = 'revenue' | 'profit';

/** One point of an API cumulative series (`chart.today` / `chart.yesterday`). */
export interface CumulativePoint {
  hour: number;
  cumulativeRevenue: string;
  cumulativeProfit: string;
}

const HOURS_IN_DAY = 24;

function fieldFor(metric: ChartMetric): 'cumulativeRevenue' | 'cumulativeProfit' {
  return metric === 'revenue' ? 'cumulativeRevenue' : 'cumulativeProfit';
}

/**
 * Forward-fill a (possibly sparse) cumulative series into a dense 0..23 lookup of
 * numbers for the chosen metric. A cumulative total does not drop when an hour has
 * no new orders, so a missing hour carries the previous value; hours before the
 * first point are 0.
 */
function densify(points: CumulativePoint[], metric: ChartMetric): number[] {
  const key = fieldFor(metric);
  const byHour = new Map(points.map((p) => [p.hour, Number(p[key])]));
  const filled: number[] = [];
  let running = 0;
  for (let hour = 0; hour < HOURS_IN_DAY; hour += 1) {
    const value = byHour.get(hour);
    if (value !== undefined) {
      running = value;
    }
    filled.push(running);
  }
  return filled;
}

/**
 * Merge the API's two independent cumulative arrays into a single 24-row chart-kit
 * dataset keyed by hour, for the comparison LineChart, reading the field named by
 * `metric`. Always returns exactly 24 rows (hours 0..23) so the x-axis is stable.
 *
 * `yesterday` is a COMPLETE past day → its value is present on every row (the
 * dashed reference spans the full axis). `today` is IN PROGRESS → its key is
 * attached only for hours up to `currentHour`; later hours omit it so the subject
 * line stops at "now" (where the chart's `liveDot` marks the leading edge).
 *
 * Revenue/profit recorded for an hour AFTER `currentHour` still counts "as of now"
 * and folds into the live edge: at `currentHour` the line carries the FULL day
 * total, not just the partial cumulative through that hour. Without this the chart
 * would silently drop today's revenue whenever an order's recorded hour reads ahead
 * of the wall clock — which happens routinely (Trendyol stamps `orderDate` as
 * Istanbul wall-clock-as-UTC, ~3h ahead; clock skew does the same) — leaving the
 * chart below the KPI cards for the same day. In the normal case (no data past
 * `currentHour`) the fold is a no-op, since the cumulative is already flat from the
 * last order through `currentHour`.
 */
export function buildChartSeries(
  today: CumulativePoint[],
  yesterday: CumulativePoint[],
  currentHour: number,
  metric: ChartMetric,
): ChartDatum[] {
  const todayFilled = densify(today, metric);
  const yesterdayFilled = densify(yesterday, metric);
  // Non-decreasing cumulative → the last bucket is the full day total (everything
  // recorded for today, including hours stamped past `currentHour`).
  const todayTotal = todayFilled[HOURS_IN_DAY - 1] ?? 0;
  return Array.from({ length: HOURS_IN_DAY }, (_, hour): ChartDatum => {
    const row: ChartDatum = { hour, yesterday: yesterdayFilled[hour] ?? 0 };
    if (hour < currentHour) {
      row.today = todayFilled[hour] ?? 0;
    } else if (hour === currentHour) {
      // The live edge carries the full total so the chart never trails the KPIs.
      row.today = todayTotal;
    }
    return row;
  });
}
