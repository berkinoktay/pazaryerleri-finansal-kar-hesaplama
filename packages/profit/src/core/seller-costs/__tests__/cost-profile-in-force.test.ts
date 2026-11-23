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
  return chooseOrderCostVersion(link, { orderDate: ORDER_DATE, at: AT })?.label ?? null;
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

  it('archived then restored before `at` is in force: priced at the order time when that version was active, else by the restore', () => {
    // Archived and restored after the order: the order-time version is the base.
    const archivedAfterOrder = makeVersion({
      label: 'archive',
      effectiveFrom: '2026-11-20T08:00:00Z',
      versionNumber: 2,
      archived: true,
    });
    const restoredAfterOrder = makeVersion({
      label: 'restore',
      effectiveFrom: '2026-11-20T09:00:00Z',
      versionNumber: 3,
    });
    const afterOrderLink = makeLink(LONG_AGO, [BASE, archivedAfterOrder, restoredAfterOrder]);
    expect(isCostLinkInForce(afterOrderLink, AT)).toBe(true);
    expect(choose(afterOrderLink)).toBe('base');

    // Archived the day before and restored after the order: the order-time version is
    // the archive version, so the restore prices it.
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

  it('a profile that existed at the order time with 100 and was edited to 120 before `at` is priced at 100', () => {
    const at100 = makeVersion({
      label: '100',
      effectiveFrom: '2026-01-01T00:00:00Z',
      versionNumber: 1,
    });
    const at120 = makeVersion({
      label: '120',
      effectiveFrom: '2026-11-20T09:00:00Z',
      versionNumber: 2,
    });
    const link = makeLink(LONG_AGO, [at120, at100]);

    expect(isCostLinkInForce(link, AT)).toBe(true);
    expect(choose(link)).toBe('100');
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
