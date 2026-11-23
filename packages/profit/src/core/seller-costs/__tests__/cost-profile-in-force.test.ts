import { getBusinessDayRange } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import {
  chooseOrderCostVersion,
  costDecisionTime,
  isCostLinkInForce,
  type CostVersionState,
  type LinkedCostProfile,
} from '../cost-profile-in-force';

/** A version with a label, so a test can name the version the rule picked. */
interface TestVersion extends CostVersionState {
  readonly label: string;
}

function makeVersion(params: {
  readonly label: string;
  readonly effectiveFrom: string;
  readonly versionNumber: number;
  readonly archived?: boolean;
}): TestVersion {
  const effectiveFrom = new Date(params.effectiveFrom);
  return {
    label: params.label,
    effectiveFrom,
    versionNumber: params.versionNumber,
    // An archive version is stamped at the instant it becomes effective.
    archivedAt: params.archived === true ? effectiveFrom : null,
  };
}

function makeLink(
  attachedAt: Date,
  versions: readonly TestVersion[],
): LinkedCostProfile<TestVersion> {
  return { attachedAt, versions };
}

const ONE_MS = 1;
const ONE_MINUTE_MS = 60 * 1000;
const LONG_AGO = new Date('2026-01-01T00:00:00Z');

// 10:00 Istanbul (UTC+3) on 2026-11-20; its business day ends at 2026-11-20T21:00Z.
const ORDER_DATE = new Date('2026-11-20T07:00:00Z');
const AT = costDecisionTime(ORDER_DATE);

const BASE = makeVersion({
  label: 'base',
  effectiveFrom: '2026-01-01T00:00:00Z',
  versionNumber: 1,
});

function choose(link: LinkedCostProfile<TestVersion>): string | null {
  return chooseOrderCostVersion(link, { at: AT })?.label ?? null;
}

const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

// Relative cases: the end of today's business day, from one clock read.
const TODAY_AT = costDecisionTime(new Date());

/** An instant `hours` before TODAY_AT. */
function hoursBeforeTodayAt(hours: number): Date {
  return new Date(TODAY_AT.getTime() - hours * ONE_HOUR_MS);
}

/** A relative-case order placed six hours before its day end: it no longer picks the price. */
const TODAY_ORDER_DATE = hoursBeforeTodayAt(6);

function chooseToday(link: LinkedCostProfile<TestVersion>): string | null {
  return chooseOrderCostVersion(link, { at: TODAY_AT })?.label ?? null;
}

describe('costDecisionTime', () => {
  it("returns the business-day end for today's order and for a past-day order", () => {
    const now = new Date();
    expect(costDecisionTime(now)).toEqual(getBusinessDayRange(now).end);
    expect(costDecisionTime(now).getTime()).toBeGreaterThan(now.getTime());

    // A past day: 10:00 and 23:30 Istanbul both end at that day's Istanbul midnight.
    expect(costDecisionTime(ORDER_DATE).toISOString()).toBe('2026-11-20T21:00:00.000Z');
    expect(costDecisionTime(new Date('2026-11-20T20:30:00Z')).toISOString()).toBe(
      '2026-11-20T21:00:00.000Z',
    );
    // 00:30 Istanbul belongs to the next business day.
    expect(costDecisionTime(new Date('2026-11-20T21:30:00Z')).toISOString()).toBe(
      '2026-11-21T21:00:00.000Z',
    );
    // The buffer's DATE anchor (UTC midnight of the business date) maps to that day.
    expect(costDecisionTime(new Date('2026-11-20T00:00:00Z')).toISOString()).toBe(
      '2026-11-20T21:00:00.000Z',
    );
  });
});

describe('isCostLinkInForce and chooseOrderCostVersion', () => {
  it('a link attached after `at` is not in force', () => {
    const link = makeLink(new Date(AT.getTime() + ONE_MS), [BASE]);

    expect(isCostLinkInForce(link, AT)).toBe(false);
    expect(choose(link)).toBeNull();
  });

  it('a profile with no version effective by `at` is not in force, and empty versions never throw', () => {
    const late = makeVersion({
      label: 'late',
      effectiveFrom: new Date(AT.getTime() + ONE_MINUTE_MS).toISOString(),
      versionNumber: 1,
    });
    const lateLink = makeLink(LONG_AGO, [late]);
    expect(isCostLinkInForce(lateLink, AT)).toBe(false);
    expect(choose(lateLink)).toBeNull();

    const emptyLink = makeLink(LONG_AGO, []);
    expect(isCostLinkInForce(emptyLink, AT)).toBe(false);
    expect(choose(emptyLink)).toBeNull();
  });

  it('a profile whose latest version by `at` is an archive version is not in force', () => {
    const archive = makeVersion({
      label: 'archive',
      effectiveFrom: '2026-11-20T05:00:00Z',
      versionNumber: 2,
      archived: true,
    });
    const link = makeLink(LONG_AGO, [BASE, archive]);

    expect(isCostLinkInForce(link, AT)).toBe(false);
    expect(choose(link)).toBeNull();
  });

  it('an archive version beats a same-instant version by its higher version number', () => {
    const edit = makeVersion({
      label: 'edit',
      effectiveFrom: '2026-11-20T05:00:00Z',
      versionNumber: 2,
    });
    const archive = makeVersion({
      label: 'archive',
      effectiveFrom: '2026-11-20T05:00:00Z',
      versionNumber: 3,
      archived: true,
    });
    const link = makeLink(LONG_AGO, [archive, BASE, edit]);

    expect(isCostLinkInForce(link, AT)).toBe(false);
  });

  it('a higher version number wins even when its effectiveFrom is earlier (overlapping archive and restore)', () => {
    // Archived the day before; then a restore and a second archive overlap: the
    // archive transaction started first (earlier effectiveFrom) but committed after
    // the restore, so it holds the higher version number and decides.
    const firstArchive = makeVersion({
      label: 'archive-1',
      effectiveFrom: '2026-11-19T10:00:00Z',
      versionNumber: 2,
      archived: true,
    });
    const restore = makeVersion({
      label: 'restore',
      effectiveFrom: '2026-11-20T07:10:00Z',
      versionNumber: 3,
    });
    const secondArchive = makeVersion({
      label: 'archive-2',
      effectiveFrom: '2026-11-20T07:05:00Z',
      versionNumber: 4,
      archived: true,
    });
    const link = makeLink(LONG_AGO, [BASE, firstArchive, restore, secondArchive]);

    expect(isCostLinkInForce(link, AT)).toBe(false);
    expect(choose(link)).toBeNull();
  });

  it('active at the order time, archived after the order, restored before at: priced by the restore version', () => {
    const active = makeVersion({
      label: 'active',
      effectiveFrom: hoursBeforeTodayAt(10).toISOString(),
      versionNumber: 1,
    });
    const archive = makeVersion({
      label: 'archive',
      effectiveFrom: hoursBeforeTodayAt(4).toISOString(),
      versionNumber: 2,
      archived: true,
    });
    const restore = makeVersion({
      label: 'restore',
      effectiveFrom: hoursBeforeTodayAt(2).toISOString(),
      versionNumber: 3,
    });
    const link = makeLink(LONG_AGO, [active, archive, restore]);

    // The order falls between the active version and the archive.
    expect(TODAY_ORDER_DATE.getTime()).toBeGreaterThan(active.effectiveFrom.getTime());
    expect(TODAY_ORDER_DATE.getTime()).toBeLessThan(archive.effectiveFrom.getTime());
    expect(isCostLinkInForce(link, TODAY_AT)).toBe(true);
    expect(chooseToday(link)).toBe('restore');
  });

  it('archived the day before and restored before `at`: in force, priced by the restore', () => {
    const archivedBefore = makeVersion({
      label: 'archive',
      effectiveFrom: '2026-11-19T10:00:00Z',
      versionNumber: 2,
      archived: true,
    });
    const restored = makeVersion({
      label: 'restore',
      effectiveFrom: '2026-11-20T09:00:00Z',
      versionNumber: 3,
    });
    const beforeOrderLink = makeLink(LONG_AGO, [BASE, archivedBefore, restored]);
    expect(isCostLinkInForce(beforeOrderLink, AT)).toBe(true);
    expect(choose(beforeOrderLink)).toBe('restore');
  });

  it('archived 09:00, restored 10:05, order 10:00 (Istanbul): in force, priced by the restore', () => {
    const archive = makeVersion({
      label: 'archive',
      effectiveFrom: '2026-11-20T06:00:00Z',
      versionNumber: 2,
      archived: true,
    });
    const restore = makeVersion({
      label: 'restore',
      effectiveFrom: '2026-11-20T07:05:00Z',
      versionNumber: 3,
    });
    const link = makeLink(LONG_AGO, [BASE, archive, restore]);

    expect(isCostLinkInForce(link, AT)).toBe(true);
    expect(choose(link)).toBe('restore');
  });

  it('a profile created after the order instant and edited before `at` is priced by the edit, not the first version', () => {
    const first = makeVersion({
      label: 'first',
      effectiveFrom: '2026-11-20T08:00:00Z',
      versionNumber: 1,
    });
    const edit = makeVersion({
      label: 'edit',
      effectiveFrom: '2026-11-20T10:00:00Z',
      versionNumber: 2,
    });
    const link = makeLink(new Date('2026-11-20T08:00:00Z'), [first, edit]);

    expect(isCostLinkInForce(link, AT)).toBe(true);
    expect(choose(link)).toBe('edit');
  });

  it('a profile priced 100 at the order time and edited to 120 before at is priced 120', () => {
    const at100 = makeVersion({
      label: '100',
      effectiveFrom: hoursBeforeTodayAt(10).toISOString(),
      versionNumber: 1,
    });
    const at120 = makeVersion({
      label: '120',
      effectiveFrom: hoursBeforeTodayAt(2).toISOString(),
      versionNumber: 2,
    });
    const link = makeLink(LONG_AGO, [at120, at100]);

    // 100 was the amount in force when the order was placed.
    expect(TODAY_ORDER_DATE.getTime()).toBeGreaterThan(at100.effectiveFrom.getTime());
    expect(TODAY_ORDER_DATE.getTime()).toBeLessThan(at120.effectiveFrom.getTime());
    expect(isCostLinkInForce(link, TODAY_AT)).toBe(true);
    expect(chooseToday(link)).toBe('120');
  });

  it('a version effective after at is ignored', () => {
    const first = makeVersion({
      label: 'first',
      effectiveFrom: hoursBeforeTodayAt(2).toISOString(),
      versionNumber: 1,
    });
    const afterAt = makeVersion({
      label: 'after-at',
      effectiveFrom: new Date(TODAY_AT.getTime() + ONE_MS).toISOString(),
      versionNumber: 2,
    });
    expect(chooseToday(makeLink(LONG_AGO, [first, afterAt]))).toBe('first');

    // Positive control: the same version effective exactly at `at` is chosen.
    const exactlyAtAt = makeVersion({
      label: 'exactly-at',
      effectiveFrom: TODAY_AT.toISOString(),
      versionNumber: 2,
    });
    expect(chooseToday(makeLink(LONG_AGO, [first, exactlyAtAt]))).toBe('exactly-at');
  });

  it('archived at at -> null', () => {
    const live = makeVersion({
      label: 'live',
      effectiveFrom: hoursBeforeTodayAt(10).toISOString(),
      versionNumber: 1,
    });
    const archivedAtAt = makeVersion({
      label: 'archive',
      effectiveFrom: TODAY_AT.toISOString(),
      versionNumber: 2,
      archived: true,
    });
    expect(chooseToday(makeLink(LONG_AGO, [live, archivedAtAt]))).toBeNull();

    // Positive control: archived one millisecond after `at`, the live version is chosen.
    const archivedAfterAt = makeVersion({
      label: 'archive',
      effectiveFrom: new Date(TODAY_AT.getTime() + ONE_MS).toISOString(),
      versionNumber: 2,
      archived: true,
    });
    expect(chooseToday(makeLink(LONG_AGO, [live, archivedAfterAt]))).toBe('live');
  });

  it('a profile archived after `at` is in force', () => {
    const archive = makeVersion({
      label: 'archive',
      effectiveFrom: new Date(AT.getTime() + ONE_MINUTE_MS).toISOString(),
      versionNumber: 2,
      archived: true,
    });
    const link = makeLink(LONG_AGO, [BASE, archive]);

    expect(isCostLinkInForce(link, AT)).toBe(true);
    expect(choose(link)).toBe('base');
  });

  it('`at` exactly equal to attachedAt and effectiveFrom counts (inclusive)', () => {
    const atBoundary = makeVersion({
      label: 'boundary',
      effectiveFrom: AT.toISOString(),
      versionNumber: 1,
    });
    const link = makeLink(AT, [atBoundary]);

    expect(isCostLinkInForce(link, AT)).toBe(true);
    expect(choose(link)).toBe('boundary');
  });
});
