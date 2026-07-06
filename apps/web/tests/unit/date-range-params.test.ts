import { describe, expect, it } from 'vitest';

import { dateRangeFromParams, dateRangeToParams } from '@/lib/date-range-params';

describe('date-range-params helpers', () => {
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

  it('emits UTC YYYY-MM-DD strings that do not shift the calendar day (timezone-safe)', () => {
    // An ISO date-only string parses as UTC midnight and toUtcIsoDate reads UTC
    // components, so the day never drifts regardless of the runner's local zone.
    // Month/day boundaries (Jan 31, Dec 01) would surface any off-by-one shift.
    const params = dateRangeToParams(dateRangeFromParams('2026-01-31', '2026-12-01'));

    expect(params.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params).toEqual({ from: '2026-01-31', to: '2026-12-01' });
  });
});
