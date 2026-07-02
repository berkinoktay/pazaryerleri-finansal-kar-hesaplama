import { describe, expect, it } from 'vitest';

import { parsePeriodPart, parseTariffPeriodLabel, resolveValidity } from '@/lib/tariff-period';

describe('parsePeriodPart', () => {
  it('parses "DD Ay HH.MM" with a Turkish month name', () => {
    expect(parsePeriodPart('26 Haziran 08.00', 2026)?.toISOString()).toBe(
      '2026-06-26T08:00:00.000Z',
    );
  });

  it('handles İstanbul-cased month names (Mayıs → mayıs)', () => {
    expect(parsePeriodPart('1 Mayıs 00.00', 2026)?.getUTCMonth()).toBe(4);
  });

  it('accepts a colon time separator too', () => {
    expect(parsePeriodPart('5 Ocak 09:30', 2026)?.toISOString()).toBe('2026-01-05T09:30:00.000Z');
  });

  it('returns null for unparseable text', () => {
    expect(parsePeriodPart('belirsiz', 2026)).toBeNull();
  });
});

describe('parseTariffPeriodLabel', () => {
  it('parses a start-end label into two instants', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel('26 Haziran 08.00-30 Haziran 07.59', 2026);
    expect(startsAt?.toISOString()).toBe('2026-06-26T08:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2026-06-30T07:59:00.000Z');
  });

  it('rolls the end into next year when it precedes the start', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel('30 Aralık 00.00-2 Ocak 00.00', 2026);
    expect(startsAt?.getUTCFullYear()).toBe(2026);
    expect(endsAt?.getUTCFullYear()).toBe(2027);
  });

  it('returns nulls for a non-range label', () => {
    expect(parseTariffPeriodLabel('Sürekli', 2026)).toEqual({ startsAt: null, endsAt: null });
  });
});

describe('resolveValidity', () => {
  const now = new Date('2026-06-28T12:00:00.000Z');

  it('is active when now is within the range', () => {
    expect(
      resolveValidity(new Date('2026-06-26T08:00:00Z'), new Date('2026-06-30T07:59:00Z'), now),
    ).toBe('active');
  });

  it('is past when now is after the end', () => {
    expect(
      resolveValidity(new Date('2026-06-20T00:00:00Z'), new Date('2026-06-25T00:00:00Z'), now),
    ).toBe('past');
  });

  it('is upcoming when now is before the start', () => {
    expect(
      resolveValidity(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-05T00:00:00Z'), now),
    ).toBe('upcoming');
  });

  it('is null when no bounds are known', () => {
    expect(resolveValidity(null, null, now)).toBeNull();
  });
});
