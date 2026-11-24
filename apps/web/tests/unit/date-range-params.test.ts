import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  businessDateToPickerDate,
  dateRangeFromParams,
  dateRangeToParams,
} from '@/lib/date-range-params';

// The picker hands over local-midnight Dates and the URL carries the calendar
// day the user picked. The zone-pinned cases below stub TZ at runtime; each one
// first asserts the pin took effect so a runner that ignores it fails loudly
// instead of passing vacuously.
const ISTANBUL_OFFSET_MINUTES = -180;
const NEW_YORK_SUMMER_OFFSET_MINUTES = 240;
const NEW_YORK_WINTER_OFFSET_MINUTES = 300;

describe('date-range-params helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a full from+to param pair through a DateRange back to the same ISO strings', () => {
    const range = dateRangeFromParams('2026-07-05', '2026-07-10');

    expect(range?.from).toBeInstanceOf(Date);
    expect(range?.to).toBeInstanceOf(Date);
    expect(dateRangeToParams(range)).toEqual({ from: '2026-07-05', to: '2026-07-10' });
  });

  it('returns an undefined range when both params are empty (no filter active)', () => {
    expect(dateRangeFromParams('', '')).toBeUndefined();
  });

  it('round-trips a partial (from-only) selection: the unset bound stays undefined, then empty', () => {
    const range = dateRangeFromParams('2026-07-05', '');

    expect(range).toBeDefined();
    expect(range?.from).toBeInstanceOf(Date);
    expect(range?.to).toBeUndefined();
    expect(dateRangeToParams(range)).toEqual({ from: '2026-07-05', to: '' });
  });

  it('projects a cleared picker (undefined range) back to an empty param pair', () => {
    expect(dateRangeToParams(undefined)).toEqual({ from: '', to: '' });
  });

  it('writes the picked local calendar day, not the UTC day (UTC+3 runner)', () => {
    vi.stubEnv('TZ', 'Europe/Istanbul');
    expect(new Date(2026, 6, 10).getTimezoneOffset()).toBe(ISTANBUL_OFFSET_MINUTES); // pin control

    expect(dateRangeToParams({ from: new Date(2026, 6, 10), to: new Date(2026, 6, 12) })).toEqual({
      from: '2026-07-10',
      to: '2026-07-12',
    });
  });

  it('reads a param as that local calendar day (UTC-4 runner)', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(new Date(2026, 6, 10).getTimezoneOffset()).toBe(NEW_YORK_SUMMER_OFFSET_MINUTES); // pin control

    expect(dateRangeFromParams('2026-07-05', '')?.from?.getDate()).toBe(5);
  });

  it.each([
    { zone: 'Europe/Istanbul', januaryOffset: ISTANBUL_OFFSET_MINUTES },
    { zone: 'America/New_York', januaryOffset: NEW_YORK_WINTER_OFFSET_MINUTES },
  ])(
    'round-trips month and day boundaries without shifting the calendar day ($zone)',
    ({ zone, januaryOffset }) => {
      vi.stubEnv('TZ', zone);
      expect(new Date(2026, 0, 31).getTimezoneOffset()).toBe(januaryOffset); // pin control

      // Jan 31 and Dec 01 would surface any off-by-one shift at a month edge.
      const params = dateRangeToParams(dateRangeFromParams('2026-01-31', '2026-12-01'));

      expect(params).toEqual({ from: '2026-01-31', to: '2026-12-01' });
    },
  );

  describe('businessDateToPickerDate', () => {
    it('gives the local midnight of the business date (UTC+3 runner)', () => {
      vi.stubEnv('TZ', 'Europe/Istanbul');
      expect(new Date(2026, 10, 23).getTimezoneOffset()).toBe(ISTANBUL_OFFSET_MINUTES); // pin control

      const date = businessDateToPickerDate('2026-11-23');

      expect(date).toBeInstanceOf(Date);
      expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([2026, 10, 23]);
      expect([date?.getHours(), date?.getMinutes()]).toEqual([0, 0]);
    });

    it('gives undefined for an empty or malformed value, never an Invalid Date', () => {
      // Control: a well-formed value gives a Date, so the undefined cases are not vacuous.
      expect(businessDateToPickerDate('2026-11-23')).toBeInstanceOf(Date);

      expect(businessDateToPickerDate('')).toBeUndefined();
      expect(businessDateToPickerDate('2026-13-40')).toBeUndefined();
      expect(businessDateToPickerDate('2026-02-30')).toBeUndefined();
      expect(businessDateToPickerDate('not-a-date')).toBeUndefined();
    });
  });
});
