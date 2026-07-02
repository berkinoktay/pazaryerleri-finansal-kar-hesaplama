import { describe, expect, it } from 'vitest';

import {
  APP_TIME_ZONE,
  businessZoneEpochToInstant,
  getBusinessDate,
  getBusinessDateAnchor,
  getBusinessDayRange,
  toUtcIsoDate,
  getBusinessHour,
} from '../src/timezone';

// Turkey time is currently UTC+3 with no DST, so the business day for a given
// instant runs [prev 21:00Z, 21:00Z). These tests pin that behaviour without
// ever naming the zone outside the single APP_TIME_ZONE constant.

describe('APP_TIME_ZONE', () => {
  it('is the single configured business timezone', () => {
    expect(APP_TIME_ZONE).toBe('Europe/Istanbul');
  });
});

describe('getBusinessDate', () => {
  it('returns the YYYY-MM-DD business date for an instant', () => {
    // 2026-05-27T20:30:00Z is 23:30 the same business day
    expect(getBusinessDate(new Date('2026-05-27T20:30:00Z'))).toBe('2026-05-27');
  });

  it('rolls to the next business date after local midnight', () => {
    // 22:00Z = 01:00 next business day
    expect(getBusinessDate(new Date('2026-05-27T22:00:00Z'))).toBe('2026-05-28');
  });

  it('defaults to now and produces a well-formed date', () => {
    expect(getBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sorts chronologically as a string (late-arrival gate contract)', () => {
    const earlier = getBusinessDate(new Date('2026-05-27T22:00:00Z')); // 2026-05-28
    const later = getBusinessDate(new Date('2026-05-29T06:00:00Z')); // 2026-05-29
    expect(earlier < later).toBe(true);
  });
});

describe('getBusinessDateAnchor', () => {
  it('anchors the business date at UTC midnight (for @db.Date columns)', () => {
    const result = getBusinessDateAnchor(new Date('2026-05-27T22:00:00Z'));
    expect(result.toISOString()).toBe('2026-05-28T00:00:00.000Z');
  });

  it('uses the same-day business date before local midnight', () => {
    const result = getBusinessDateAnchor(new Date('2026-05-27T20:30:00Z'));
    expect(result.toISOString()).toBe('2026-05-27T00:00:00.000Z');
  });
});

describe('getBusinessDayRange', () => {
  it('returns the real UTC instant window of the business day', () => {
    const { start, end } = getBusinessDayRange(new Date('2026-05-27T20:30:00Z'));
    // Business day 2026-05-27 = [2026-05-26T21:00Z, 2026-05-27T21:00Z)
    expect(start.toISOString()).toBe('2026-05-26T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-27T21:00:00.000Z');
  });

  it('places an after-midnight instant in the next business day window', () => {
    const at = new Date('2026-05-27T22:00:00Z'); // 01:00 business next day
    const { start, end } = getBusinessDayRange(at);
    expect(start.toISOString()).toBe('2026-05-27T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-28T21:00:00.000Z');
    // The window is half-open and contains the instant
    expect(at.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(at.getTime()).toBeLessThan(end.getTime());
  });

  it('spans exactly 24h while the zone observes no DST', () => {
    const { start, end } = getBusinessDayRange(new Date('2026-03-29T12:00:00Z'));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('getBusinessHour', () => {
  it('returns the business-timezone hour (0–23)', () => {
    expect(getBusinessHour(new Date('2026-05-27T20:30:00Z'))).toBe(23);
    expect(getBusinessHour(new Date('2026-05-27T22:00:00Z'))).toBe(1);
    expect(getBusinessHour(new Date('2026-05-27T21:00:00Z'))).toBe(0); // local midnight
  });
});

describe('businessZoneEpochToInstant', () => {
  it('reinterprets a GMT+3 (Istanbul wall-clock-as-UTC) epoch as the true instant', () => {
    // A Trendyol-style orderDate: the order was placed at 14:30 Istanbul, but the
    // epoch reads "14:30" in UTC (3h ahead of the real 11:30Z instant).
    const gmt3Epoch = Date.UTC(2026, 5, 5, 14, 30, 0);
    const instant = businessZoneEpochToInstant(gmt3Epoch);
    expect(instant.toISOString()).toBe('2026-06-05T11:30:00.000Z');
    // Business-hour math now sees 14 (the seller's real local hour), not 17.
    expect(getBusinessHour(instant)).toBe(14);
  });

  it('keeps the value on the correct business day near local midnight', () => {
    // 23:30 Istanbul stamped as 23:30Z → true instant 20:30Z, still business day
    // 2026-06-05 — not 02:30 next day (the bug the +3h shift caused).
    const gmt3Epoch = Date.UTC(2026, 5, 5, 23, 30, 0);
    const instant = businessZoneEpochToInstant(gmt3Epoch);
    expect(getBusinessDate(instant)).toBe('2026-06-05');
    expect(getBusinessHour(instant)).toBe(23);
  });
});

describe('toUtcIsoDate', () => {
  it('extracts the UTC calendar day regardless of local wall-clock', () => {
    // 23:30 UTC — in İstanbul (UTC+3) this is already the NEXT local day;
    // the backend's coerce.date() expects the UTC day.
    expect(toUtcIsoDate(new Date('2026-07-02T23:30:00Z'))).toBe('2026-07-02');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toUtcIsoDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});
