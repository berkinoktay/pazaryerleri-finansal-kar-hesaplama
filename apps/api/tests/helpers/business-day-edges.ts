import { getBusinessDate, getBusinessDayRangeOfDate } from '@pazarsync/utils';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A closed business day and four instants around its edges. */
export interface BusinessDayEdges {
  /** The business date (`YYYY-MM-DD`), as the date filters take it. */
  readonly day: string;
  /** 00:30 Istanbul on `day`. */
  readonly earlyInDay: Date;
  /** 23:30 Istanbul on `day`. */
  readonly lateInDay: Date;
  /** 23:30 Istanbul on the day before `day`. */
  readonly prevDayLate: Date;
  /** 00:10 Istanbul on the day after `day`. */
  readonly nextDayEarly: Date;
}

/**
 * The business day three days back and four instants around its edges: two
 * inside it (00:30 and 23:30 Istanbul) and one just outside each edge. Shared by
 * the orders and returns date-filter tests, which pin that `from`/`to` select
 * whole Istanbul business days.
 */
export function businessDayEdges(): BusinessDayEdges {
  const day = getBusinessDate(new Date(Date.now() - 3 * DAY_MS));
  const { start, end } = getBusinessDayRangeOfDate(day);
  return {
    day,
    earlyInDay: new Date(start.getTime() + 30 * MINUTE_MS),
    lateInDay: new Date(end.getTime() - 30 * MINUTE_MS),
    prevDayLate: new Date(start.getTime() - 30 * MINUTE_MS),
    nextDayEarly: new Date(end.getTime() + 10 * MINUTE_MS),
  };
}
