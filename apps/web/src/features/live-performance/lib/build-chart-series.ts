/** One point of an API cumulative-profit series (`chart.today` / `chart.yesterday`). */
export interface CumulativePoint {
  hour: number;
  cumulativeProfit: string;
}

/** One merged row consumed by the recharts dual-line chart. */
export interface ChartSeriesPoint {
  hour: number;
  today: number;
  yesterday: number;
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
 * Merge the API's two independent cumulative-profit arrays into a single
 * 24-row recharts dataset keyed by hour. Always returns exactly 24 rows
 * (hours 0..23) so the x-axis is stable regardless of how far into the day
 * the live data has progressed.
 */
export function buildChartSeries(
  today: CumulativePoint[],
  yesterday: CumulativePoint[],
): ChartSeriesPoint[] {
  const todayFilled = densify(today);
  const yesterdayFilled = densify(yesterday);
  return Array.from({ length: HOURS_IN_DAY }, (_, hour) => ({
    hour,
    today: todayFilled[hour] ?? 0,
    yesterday: yesterdayFilled[hour] ?? 0,
  }));
}
