import { describe, expect, it, vi } from 'vitest';

import {
  findOverlappingWeek,
  parsePeriodPart,
  parseTariffPeriodLabel,
  resolveTariffWeek,
  resolveValidity,
  WEEK_UNIQUE_COLUMN,
  type TariffWeek,
} from '@/workbooks/tariff-week';
import { WorkbookFileRejection } from '@/workbooks/workbook-errors';

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

// The Turkish month of December, by code point (the dotless i).
const DECEMBER = `Aral${String.fromCodePoint(0x0131)}k`;

// The two period labels of the split-week Plus fixture.
const THREE_DAY_LABEL = '7 Temmuz 08.00-10 Temmuz 07.59';
const FOUR_DAY_LABEL = '10 Temmuz 08.00-14 Temmuz 07.59';

describe('resolveTariffWeek', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  function rejectionOf(fn: () => unknown): WorkbookFileRejection {
    try {
      fn();
    } catch (err) {
      if (err instanceof WorkbookFileRejection) return err;
      throw err;
    }
    throw new Error('expected a WorkbookFileRejection');
  }

  it('keeps the periods whose label is filled on the first row, with their layout index', () => {
    const week = resolveTariffWeek(
      [
        { tag: 3, label: null },
        { tag: 4, label: FOUR_DAY_LABEL },
      ],
      now,
    );

    expect(week).toStrictEqual({
      present: [
        {
          label: FOUR_DAY_LABEL,
          dayCount: 4,
          startsAt: new Date('2026-07-10T08:00:00.000Z'),
          endsAt: new Date('2026-07-14T07:59:00.000Z'),
          sortOrder: 0,
          layoutIndex: 1,
        },
      ],
      weekStartsAt: new Date('2026-07-10T08:00:00.000Z'),
      weekEndsAt: new Date('2026-07-14T07:59:00.000Z'),
    });
  });

  it('refuses a first row without any period label with NO_PERIOD', () => {
    expect(rejectionOf(() => resolveTariffWeek([{ tag: 7, label: null }], now)).code).toBe(
      'NO_PERIOD',
    );
    expect(rejectionOf(() => resolveTariffWeek([], now)).code).toBe('NO_PERIOD');
  });

  it('bounds the week by the earliest start and the latest end, whatever the block order', () => {
    const week = resolveTariffWeek(
      [
        { tag: 4, label: FOUR_DAY_LABEL },
        { tag: 3, label: THREE_DAY_LABEL },
      ],
      now,
    );

    expect(
      week.present.map((period) => [period.dayCount, period.sortOrder, period.layoutIndex]),
    ).toEqual([
      [4, 0, 0],
      [3, 1, 1],
    ]);
    expect(week.weekStartsAt?.toISOString()).toBe('2026-07-07T08:00:00.000Z');
    expect(week.weekEndsAt?.toISOString()).toBe('2026-07-14T07:59:00.000Z');
  });

  it('rolls a period that ends in January into the year after now', () => {
    const week = resolveTariffWeek([{ tag: 7, label: `29 ${DECEMBER} 08.00-5 Ocak 07.59` }], now);

    expect(week.weekStartsAt?.toISOString()).toBe('2026-12-29T08:00:00.000Z');
    expect(week.weekEndsAt?.toISOString()).toBe('2027-01-05T07:59:00.000Z');
  });

  it('reads the year of the labels from now, in UTC', () => {
    const lateNewYearsEve = new Date('2027-12-31T23:30:00.000Z');

    const week = resolveTariffWeek([{ tag: 7, label: THREE_DAY_LABEL }], lateNewYearsEve);

    expect(week.weekStartsAt?.toISOString()).toBe('2027-07-07T08:00:00.000Z');
  });

  it('keeps a period whose label does not parse, and bounds the week by the parsed ones', () => {
    const unparsed = resolveTariffWeek([{ tag: 7, label: 'Surekli' }], now);
    const mixed = resolveTariffWeek(
      [
        { tag: 3, label: 'Surekli' },
        { tag: 4, label: FOUR_DAY_LABEL },
      ],
      now,
    );

    expect(unparsed.present).toEqual([
      { label: 'Surekli', dayCount: 7, startsAt: null, endsAt: null, sortOrder: 0, layoutIndex: 0 },
    ]);
    expect([unparsed.weekStartsAt, unparsed.weekEndsAt]).toEqual([null, null]);
    expect(mixed.present).toHaveLength(2);
    expect(mixed.weekStartsAt?.toISOString()).toBe('2026-07-10T08:00:00.000Z');
    expect(mixed.weekEndsAt?.toISOString()).toBe('2026-07-14T07:59:00.000Z');
  });
});

describe('findOverlappingWeek', () => {
  const scope = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    storeId: '22222222-2222-4222-8222-222222222222',
  };
  const week: TariffWeek = {
    present: [],
    weekStartsAt: new Date('2026-07-07T08:00:00.000Z'),
    weekEndsAt: new Date('2026-07-14T07:59:00.000Z'),
  };

  it("asks for a tariff of the scope's store whose week overlaps, and returns it", async () => {
    const findFirst = vi.fn(async () => ({ id: 'tariff-1' }));

    await expect(findOverlappingWeek({ findFirst }, scope, week)).resolves.toEqual({
      id: 'tariff-1',
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: scope.organizationId,
        storeId: scope.storeId,
        weekStartsAt: { lt: week.weekEndsAt },
        weekEndsAt: { gt: week.weekStartsAt },
      },
      select: { id: true },
    });
  });

  it('returns null when no tariff overlaps', async () => {
    const findFirst = vi.fn(async () => null);

    await expect(findOverlappingWeek({ findFirst }, scope, week)).resolves.toBeNull();
  });

  it('does not ask when a week bound is unknown', async () => {
    const findFirst = vi.fn(async () => ({ id: 'tariff-1' }));

    await expect(
      findOverlappingWeek({ findFirst }, scope, { ...week, weekStartsAt: null }),
    ).resolves.toBeNull();
    await expect(
      findOverlappingWeek({ findFirst }, scope, { ...week, weekEndsAt: null }),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('names the column of the one-tariff-per-week unique index', () => {
    expect(WEEK_UNIQUE_COLUMN).toBe('week_starts_at');
  });
});
