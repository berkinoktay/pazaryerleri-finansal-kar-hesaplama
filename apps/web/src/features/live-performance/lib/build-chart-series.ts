import type { ChartDatum } from '@/components/patterns/chart.types';

/** One point of an API cumulative-profit series (`chart.today` / `chart.yesterday`). */
export interface CumulativePoint {
  hour: number;
  cumulativeProfit: string;
}

const HOURS_IN_DAY = 24;

/**
 * Forward-fill a (possibly sparse) cumulative series into a dense 0..23 lookup
 * of numbers. A cumulative total does not drop when an hour has no new orders,
 * so a missing hour carries the previous value; hours before the first point
 * are 0.
 */
function densify(points: CumulativePoint[]): number[] {
  const byHour = new Map(points.map((p) => [p.hour, Number(p.cumulativeProfit)]));
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
 * Merge the API's two independent cumulative-profit arrays into a single 24-row
 * chart-kit dataset keyed by hour, for the comparison LineChart. Always returns
 * exactly 24 rows (hours 0..23) so the x-axis is stable regardless of how far
 * into the day the live data has progressed.
 *
 * `yesterday` is a COMPLETE past day, so its value is present on every row (the
 * dashed reference line spans the full axis). `today` is IN PROGRESS, so its key
 * is attached only for hours up to `currentHour` (the business-day hour, 0..23);
 * later hours omit it entirely so the subject line stops at "now" — where the
 * chart's `liveDot` marks the leading edge — instead of flat-lining forward.
 */
export function buildChartSeries(
  today: CumulativePoint[],
  yesterday: CumulativePoint[],
  currentHour: number,
): ChartDatum[] {
  const todayFilled = densify(today);
  const yesterdayFilled = densify(yesterday);
  return Array.from({ length: HOURS_IN_DAY }, (_, hour): ChartDatum => {
    const row: ChartDatum = { hour, yesterday: yesterdayFilled[hour] ?? 0 };
    if (hour <= currentHour) {
      row.today = todayFilled[hour] ?? 0;
    }
    return row;
  });
}
