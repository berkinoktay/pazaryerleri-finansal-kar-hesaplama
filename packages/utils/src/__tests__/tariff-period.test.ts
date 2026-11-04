import { describe, expect, it } from 'vitest';

import {
  findCoveringTariffPeriod,
  isInstantWithinTariffPeriod,
  tariffBoundToInstant,
} from '../tariff-period';

// Tariff period bounds are stored as Istanbul wall-clock saved verbatim as UTC
// (UTC+3, no DST), while the moment they are matched against is a true instant.
// The helper reconciles the two frames: a bound of 08.00Z is really 05.00Z, and
// a period is covered half-open [start, end) at the real instant.

describe('tariffBoundToInstant', () => {
  it('converts a stored wall-clock bound to the real instant', () => {
    expect(tariffBoundToInstant(new Date('2026-07-10T08:00:00.000Z')).toISOString()).toBe(
      '2026-07-10T05:00:00.000Z',
    );
  });
});

describe('isInstantWithinTariffPeriod', () => {
  const period = {
    startsAt: new Date('2026-07-10T00:00:00.000Z'),
    endsAt: new Date('2026-07-13T00:00:00.000Z'),
  };

  it('treats the end bound as exclusive', () => {
    // The real end instant (Istanbul midnight 2026-07-13) is 2026-07-12T21:00Z.
    expect(isInstantWithinTariffPeriod(period, new Date('2026-07-12T21:00:00.000Z'))).toBe(false);
    expect(isInstantWithinTariffPeriod(period, new Date('2026-07-12T20:59:59.999Z'))).toBe(true);
  });
});

describe('findCoveringTariffPeriod', () => {
  it('picks the period that starts at Istanbul midnight, not the one that ended', () => {
    const periodA = {
      id: 'A',
      startsAt: new Date('2026-07-07T00:00:00.000Z'),
      endsAt: new Date('2026-07-10T00:00:00.000Z'),
    };
    const periodB = {
      id: 'B',
      startsAt: new Date('2026-07-10T00:00:00.000Z'),
      endsAt: new Date('2026-07-13T00:00:00.000Z'),
    };
    // The real instant of Istanbul midnight 2026-07-10 is 2026-07-09T21:00Z. The
    // earlier period's end is exclusive, the later period's start is inclusive.
    const at = new Date('2026-07-09T21:00:00.000Z');
    expect(findCoveringTariffPeriod([periodA, periodB], at)?.id).toBe('B');
  });

  it('returns null when no period covers the instant', () => {
    const periods = [
      {
        id: 'A',
        startsAt: new Date('2026-07-07T00:00:00.000Z'),
        endsAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ];
    expect(findCoveringTariffPeriod(periods, new Date('2026-08-01T00:00:00.000Z'))).toBeNull();
  });
});
