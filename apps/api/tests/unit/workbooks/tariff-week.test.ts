import { describe, expect, it, vi } from 'vitest';

import { SpreadsheetFileError } from '@pazarsync/spreadsheet';
import { TARIFF_WEEK_DAYS } from '@pazarsync/utils';

import {
  findOverlappingWeek,
  parseTariffPeriodLabel,
  requireTariffPeriods,
  requireWritableWindows,
  resolveTariffWeek,
  resolveValidity,
  TARIFF_PERIODS_REASON,
  TARIFF_WEEK_SPAN_REASON,
  WEEK_UNIQUE_COLUMN,
  type TariffWeek,
} from '@/workbooks/tariff-week';
import { tariffSelectionLabel } from '@/workbooks/formats/trendyol/labels';
import { TARIFF_SELECTION_WRITE } from '@/workbooks/formats/trendyol/tariff-window';
import { WorkbookFileRejection } from '@/workbooks/workbook-errors';
import { UNWRITABLE_VALUE_REASON } from '@/workbooks/write-columns';

describe('parseTariffPeriodLabel', () => {
  const midJune2026 = new Date('2026-06-15T00:00:00.000Z');

  it('handles İstanbul-cased month names (Mayıs → mayıs)', () => {
    const { startsAt } = parseTariffPeriodLabel('1 Mayıs 00.00-5 Mayıs 00.00', midJune2026);
    expect(startsAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('accepts a colon time separator too', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel(
      '26 Haziran 08:00-30 Haziran 07:59',
      midJune2026,
    );
    expect(startsAt?.toISOString()).toBe('2026-06-26T08:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2026-06-30T07:59:00.000Z');
  });

  it('keeps the half that parses when the other does not', () => {
    expect(parseTariffPeriodLabel('belirsiz-30 Haziran 07.59', midJune2026)).toEqual({
      startsAt: null,
      endsAt: new Date('2026-06-30T07:59:00.000Z'),
    });
    expect(parseTariffPeriodLabel('26 Haziran 08.00-belirsiz', midJune2026)).toEqual({
      startsAt: new Date('2026-06-26T08:00:00.000Z'),
      endsAt: null,
    });
  });

  it('places 29 Şubat only in a leap year', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel(
      '29 Şubat 08.00-3 Mart 07.59',
      new Date('2028-02-20T00:00:00.000Z'),
    );
    expect(startsAt?.toISOString()).toBe('2028-02-29T08:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2028-03-03T07:59:00.000Z');
  });

  it('moves an end the start year does not have to the year after', () => {
    // 2027 has no 29 Şubat, so the end lands in 2028: a malformed label, a year long,
    // which requireTariffPeriods refuses (tariff-week-span).
    const { startsAt, endsAt } = parseTariffPeriodLabel(
      '28 Şubat 08.00-29 Şubat 07.59',
      new Date('2027-02-20T00:00:00.000Z'),
    );
    expect(startsAt?.toISOString()).toBe('2027-02-28T08:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2028-02-29T07:59:00.000Z');
  });

  it('parses a start-end label into two instants', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel(
      '26 Haziran 08.00-30 Haziran 07.59',
      midJune2026,
    );
    expect(startsAt?.toISOString()).toBe('2026-06-26T08:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2026-06-30T07:59:00.000Z');
  });

  it('rolls the end into the year after the start when it precedes the start', () => {
    const { startsAt, endsAt } = parseTariffPeriodLabel(
      '30 Aralık 00.00-2 Ocak 00.00',
      new Date('2026-12-20T00:00:00.000Z'),
    );
    expect(startsAt?.toISOString()).toBe('2026-12-30T00:00:00.000Z');
    expect(endsAt?.toISOString()).toBe('2027-01-02T00:00:00.000Z');
  });

  it('gives the start the year a year back, the same or a year on that is closest to the reference', () => {
    const label = '5 Ocak 08.00-12 Ocak 07.59';

    expect(
      parseTariffPeriodLabel(label, new Date('2026-12-28T00:00:00.000Z')).startsAt?.toISOString(),
    ).toBe('2027-01-05T08:00:00.000Z');
    expect(
      parseTariffPeriodLabel(label, new Date('2027-01-20T00:00:00.000Z')).startsAt?.toISOString(),
    ).toBe('2027-01-05T08:00:00.000Z');
    expect(
      parseTariffPeriodLabel(label, new Date('2027-03-01T00:00:00.000Z')).startsAt?.toISOString(),
    ).toBe('2027-01-05T08:00:00.000Z');
  });

  it('returns nulls for a non-range label', () => {
    expect(parseTariffPeriodLabel('Sürekli', midJune2026)).toEqual({
      startsAt: null,
      endsAt: null,
    });
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

  it('rolls a period that ends in January into the year after its start', () => {
    const week = resolveTariffWeek(
      [{ tag: 7, label: `29 ${DECEMBER} 08.00-5 Ocak 07.59` }],
      new Date('2026-12-20T12:00:00.000Z'),
    );

    expect(week.weekStartsAt?.toISOString()).toBe('2026-12-29T08:00:00.000Z');
    expect(week.weekEndsAt?.toISOString()).toBe('2027-01-05T07:59:00.000Z');
  });

  describe('a week that crosses New Year', () => {
    // The 2026 year-end week as Trendyol splits it: Tuesday to Friday, Friday to Tuesday.
    const splitYearEndWeek = [
      { tag: 3, label: `29 ${DECEMBER} 08.00-1 Ocak 07.59` },
      { tag: 4, label: '1 Ocak 08.00-5 Ocak 07.59' },
    ];
    const expectedPeriods = [
      ['2026-12-29T08:00:00.000Z', '2027-01-01T07:59:00.000Z'],
      ['2027-01-01T08:00:00.000Z', '2027-01-05T07:59:00.000Z'],
    ];

    function boundsOf(week: TariffWeek): (string | undefined)[][] {
      return week.present.map((period) => [
        period.startsAt?.toISOString(),
        period.endsAt?.toISOString(),
      ]);
    }

    it.each([
      ['in December, before the week', '2026-12-27T09:00:00.000Z'],
      ['in January, during the week', '2027-01-02T09:00:00.000Z'],
      ['on New Year night in Istanbul, still New Year Eve in UTC', '2026-12-31T22:30:00.000Z'],
    ])('places both halves in their own year when uploaded %s', (_when, at) => {
      const week = resolveTariffWeek(splitYearEndWeek, new Date(at));

      expect(boundsOf(week)).toEqual(expectedPeriods);
      expect(week.weekStartsAt?.toISOString()).toBe('2026-12-29T08:00:00.000Z');
      expect(week.weekEndsAt?.toISOString()).toBe('2027-01-05T07:59:00.000Z');
    });

    it('places the halves by the first one whatever the block order', () => {
      const week = resolveTariffWeek(
        [...splitYearEndWeek].reverse(),
        new Date('2026-12-27T09:00:00.000Z'),
      );

      expect(week.weekStartsAt?.toISOString()).toBe('2026-12-29T08:00:00.000Z');
      expect(week.weekEndsAt?.toISOString()).toBe('2027-01-05T07:59:00.000Z');
    });

    it('keeps the halves together when the upload day is about six months away', () => {
      // From 1 July 2026, 29 December 2026 is the closest 29 December, but 1 January
      // 2026 is closer than 1 January 2027: only placing the second half by the first
      // one keeps the week whole.
      const week = resolveTariffWeek(splitYearEndWeek, new Date('2026-07-01T09:00:00.000Z'));

      expect(boundsOf(week)).toEqual(expectedPeriods);
    });

    it('places a December-only half and a crossing half uploaded in January in the old year', () => {
      const week = resolveTariffWeek(
        [
          { tag: 3, label: `26 ${DECEMBER} 08.00-29 ${DECEMBER} 07.59` },
          { tag: 4, label: `29 ${DECEMBER} 08.00-2 Ocak 07.59` },
        ],
        new Date('2027-01-01T10:00:00.000Z'),
      );

      expect(week.weekStartsAt?.toISOString()).toBe('2026-12-26T08:00:00.000Z');
      expect(week.weekEndsAt?.toISOString()).toBe('2027-01-02T07:59:00.000Z');
    });

    it('places a January week uploaded in December in the coming year', () => {
      const week = resolveTariffWeek(
        [{ tag: 7, label: '5 Ocak 08.00-12 Ocak 07.59' }],
        new Date('2026-12-28T09:00:00.000Z'),
      );

      expect(week.weekStartsAt?.toISOString()).toBe('2027-01-05T08:00:00.000Z');
      expect(week.weekEndsAt?.toISOString()).toBe('2027-01-12T07:59:00.000Z');
    });
  });

  it('reads the upload day in Istanbul, not in UTC', () => {
    // 22:00 UTC on 31 December is 01:00 on 1 January in Istanbul. From 1 January 2027,
    // 2 July 2027 is closer than 2 July 2026; from 31 December 2026 it is the other way.
    const week = resolveTariffWeek(
      [{ tag: 7, label: '2 Temmuz 08.00-9 Temmuz 07.59' }],
      new Date('2026-12-31T22:00:00.000Z'),
    );

    expect(week.weekStartsAt?.toISOString()).toBe('2027-07-02T08:00:00.000Z');
  });

  it("places later labels by the first label's end when only its end parses", () => {
    // From 1 July 2026, 29 December 2026 is the closest 29 December, but 2 January 2026
    // is closer than 2 January 2027: the second label follows the first one's end.
    const week = resolveTariffWeek(
      [
        { tag: 3, label: `belirsiz-29 ${DECEMBER} 07.59` },
        { tag: 4, label: '2 Ocak 08.00-5 Ocak 07.59' },
      ],
      new Date('2026-07-01T09:00:00.000Z'),
    );

    expect(week.present.map((period) => period.endsAt?.toISOString())).toEqual([
      '2026-12-29T07:59:00.000Z',
      '2027-01-05T07:59:00.000Z',
    ]);
    expect(week.present[1]?.startsAt?.toISOString()).toBe('2027-01-02T08:00:00.000Z');
  });

  it('gives labels of two different weeks a span that requireTariffPeriods refuses', () => {
    const week = resolveTariffWeek(
      [
        { tag: 3, label: '1 Ocak 08.00-4 Ocak 07.59' },
        { tag: 4, label: '1 Haziran 08.00-5 Haziran 07.59' },
      ],
      new Date('2026-03-01T09:00:00.000Z'),
    );

    let refusal: unknown = null;
    try {
      requireTariffPeriods(week);
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(SpreadsheetFileError);
    if (!(refusal instanceof SpreadsheetFileError)) return;
    expect(refusal.meta).toEqual({ reason: TARIFF_WEEK_SPAN_REASON });
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

describe('requireTariffPeriods', () => {
  /** A week whose present periods carry `dayCounts`, in order, with unparsed labels. */
  function weekOf(dayCounts: readonly number[]): TariffWeek {
    return {
      present: dayCounts.map((dayCount, index) => ({
        label: `period ${index + 1}`,
        dayCount,
        startsAt: null,
        endsAt: null,
        sortOrder: index,
        layoutIndex: index,
      })),
      weekStartsAt: null,
      weekEndsAt: null,
    };
  }

  function oneDayPeriods(count: number): number[] {
    return Array.from({ length: count }, () => 1);
  }

  function refusalOf(week: TariffWeek): SpreadsheetFileError {
    try {
      requireTariffPeriods(week);
    } catch (err) {
      if (err instanceof SpreadsheetFileError) return err;
      throw err;
    }
    throw new Error('expected a SpreadsheetFileError');
  }

  it('passes the real split week and the real single-period week', () => {
    expect(() => requireTariffPeriods(weekOf([3, 4]))).not.toThrow();
    expect(() => requireTariffPeriods(weekOf([7]))).not.toThrow();
  });

  it('refuses a period of 0 days with MALFORMED_SHEET tariff-periods', () => {
    for (const dayCounts of [[0], [3, 0, 4]]) {
      const err = refusalOf(weekOf(dayCounts));

      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: TARIFF_PERIODS_REASON });
      expect(err.meta['reason']).toBe('tariff-periods');
    }
  });

  it('passes periods of different day counts that fill a week', () => {
    expect(() => requireTariffPeriods(weekOf([1, 2, 4]))).not.toThrow();
  });

  it('refuses periods whose day counts add up to more than a week', () => {
    for (const dayCounts of [[8], [3, 5]]) {
      const err = refusalOf(weekOf(dayCounts));

      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: TARIFF_PERIODS_REASON });
    }
  });

  it('refuses two periods of one day count, which the export cannot tell apart', () => {
    for (const dayCounts of [[3, 3], oneDayPeriods(TARIFF_WEEK_DAYS)]) {
      const err = refusalOf(weekOf(dayCounts));

      expect(err.code).toBe('MALFORMED_SHEET');
      expect(err.meta).toEqual({ reason: TARIFF_PERIODS_REASON });
    }
  });

  it('refuses two periods with one date-range label', () => {
    const week = weekOf([3, 4]);
    const repeatedLabel: TariffWeek = {
      ...week,
      present: week.present.map((period) => ({ ...period, label: THREE_DAY_LABEL })),
    };

    expect(refusalOf(repeatedLabel).meta).toEqual({ reason: TARIFF_PERIODS_REASON });
  });

  it('passes dates that span a week, to the minute before the next one starts', () => {
    expect(() =>
      requireTariffPeriods({
        ...weekOf([7]),
        weekStartsAt: new Date('2026-06-30T08:00:00.000Z'),
        weekEndsAt: new Date('2026-07-07T07:59:00.000Z'),
      }),
    ).not.toThrow();
  });

  it('refuses dates that span more than a week with MALFORMED_SHEET tariff-week-span', () => {
    const err = refusalOf({
      ...weekOf([3, 4]),
      weekStartsAt: new Date('2026-01-01T08:00:00.000Z'),
      weekEndsAt: new Date('2027-01-01T07:59:00.000Z'),
    });

    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: TARIFF_WEEK_SPAN_REASON });
    expect(err.meta['reason']).toBe('tariff-week-span');
  });
});

describe('requireWritableWindows', () => {
  // requireTariffPeriods refuses a week of more than seven days first; this rule stays as
  // the check that every window label the export writes passes the column's own rule.
  const write = { spec: TARIFF_SELECTION_WRITE, label: tariffSelectionLabel };

  function weekOfDays(dayCounts: readonly number[]): TariffWeek {
    return {
      present: dayCounts.map((dayCount, index) => ({
        label: `period ${index + 1}`,
        dayCount,
        startsAt: null,
        endsAt: null,
        sortOrder: index,
        layoutIndex: index,
      })),
      weekStartsAt: null,
      weekEndsAt: null,
    };
  }

  it('passes the windows of the real split week and of a whole week', () => {
    expect(() => requireWritableWindows(weekOfDays([3, 4]), write)).not.toThrow();
    expect(() => requireWritableWindows(weekOfDays([7]), write)).not.toThrow();
  });

  it('refuses a window wider than the column probe with MALFORMED_SHEET unwritable-value', () => {
    let refusal: unknown = null;
    try {
      requireWritableWindows(weekOfDays([10]), write);
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(SpreadsheetFileError);
    if (!(refusal instanceof SpreadsheetFileError)) return;
    expect(refusal.code).toBe('MALFORMED_SHEET');
    expect(refusal.meta).toEqual({ reason: UNWRITABLE_VALUE_REASON });
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
