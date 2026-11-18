import { describe, expect, it, vi } from 'vitest';

// The picker module links to the commission tariff page with next-intl's localized <Link>,
// which pulls in `next/navigation`; this pure test never renders it.
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));

import type { CommissionTariffListItem } from '@/features/campaigns/api/list-tariffs.api';
import {
  CATEGORY_COMMISSION_SOURCE,
  resolveCommissionSource,
} from '@/features/campaigns/components/commission-source-picker';

function tariff(
  id: string,
  validity: CommissionTariffListItem['validity'],
  weekStartsAt: string | null,
): CommissionTariffListItem {
  return {
    id,
    name: `tariff-${id}`,
    productCount: 10,
    selectedCount: 0,
    exported: false,
    validity,
    weekStartsAt,
    weekEndsAt: null,
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

const PAST = tariff('t-past', 'past', '2026-06-24T05:00:00Z');
const ACTIVE = tariff('t-active', 'active', '2026-07-01T05:00:00Z');
const UPCOMING = tariff('t-next', 'upcoming', '2026-07-08T05:00:00Z');
const LATER = tariff('t-later', 'upcoming', '2026-07-15T05:00:00Z');
// Newest first, as the API lists them.
const TARIFFS = [LATER, UPCOMING, ACTIVE, PAST];
// No tariff refused yet.
const NONE: ReadonlySet<string> = new Set();

describe('resolveCommissionSource', () => {
  it('keeps a choice the loaded list holds', () => {
    expect(resolveCommissionSource(ACTIVE.id, TARIFFS, false, NONE)).toBe(ACTIVE.id);
  });

  it.each([
    ['a loaded list', TARIFFS, false],
    ['an empty list', [], false],
    ['an unloaded list', undefined, true],
  ])('keeps the category choice with %s', (_label, tariffs, loading) => {
    expect(resolveCommissionSource(CATEGORY_COMMISSION_SOURCE, tariffs, loading, NONE)).toBe(
      CATEGORY_COMMISSION_SOURCE,
    );
  });

  it('keeps the category choice when a tariff was refused', () => {
    expect(
      resolveCommissionSource(CATEGORY_COMMISSION_SOURCE, TARIFFS, false, new Set([UPCOMING.id])),
    ).toBe(CATEGORY_COMMISSION_SOURCE);
  });

  it('falls to the default for a choice missing from the loaded list', () => {
    expect(resolveCommissionSource('t-deleted', TARIFFS, false, NONE)).toBe(UPCOMING.id);
  });

  it('keeps a choice while the list has not loaded yet', () => {
    expect(resolveCommissionSource(ACTIVE.id, undefined, true, NONE)).toBe(ACTIVE.id);
  });

  it('picks nothing after the choice was refused, so the seller chooses the next source', () => {
    // The refused week is still in the cached list until the refetch lands; moving to another
    // week on its own would price the list on a week the seller never chose.
    expect(
      resolveCommissionSource(UPCOMING.id, TARIFFS, false, new Set([UPCOMING.id])),
    ).toBeUndefined();
  });

  it('derives no default at all after a refusal', () => {
    expect(
      resolveCommissionSource(undefined, TARIFFS, false, new Set([UPCOMING.id])),
    ).toBeUndefined();
  });

  it("keeps the seller's own pick of another week after a refusal", () => {
    expect(resolveCommissionSource(LATER.id, TARIFFS, false, new Set([UPCOMING.id]))).toBe(
      LATER.id,
    );
  });

  it('resolves to nothing when the refused tariff is the only one', () => {
    expect(
      resolveCommissionSource(UPCOMING.id, [UPCOMING], false, new Set([UPCOMING.id])),
    ).toBeUndefined();
    expect(
      resolveCommissionSource(undefined, [UPCOMING], false, new Set([UPCOMING.id])),
    ).toBeUndefined();
  });

  it('drops a pick of any refused week, not only the last one', () => {
    const refused = new Set([UPCOMING.id, LATER.id]);
    expect(resolveCommissionSource(UPCOMING.id, TARIFFS, false, refused)).toBeUndefined();
    expect(resolveCommissionSource(LATER.id, TARIFFS, false, refused)).toBeUndefined();
    expect(resolveCommissionSource(ACTIVE.id, TARIFFS, false, refused)).toBe(ACTIVE.id);
  });

  it('resolves to nothing while the list loads and there is no choice', () => {
    expect(resolveCommissionSource(undefined, undefined, true, NONE)).toBeUndefined();
  });

  describe('the default without a choice and without a refusal', () => {
    it('is the nearest upcoming tariff', () => {
      expect(resolveCommissionSource(undefined, TARIFFS, false, NONE)).toBe(UPCOMING.id);
    });

    it('is the latest current or past tariff when none is upcoming', () => {
      expect(resolveCommissionSource(undefined, [ACTIVE, PAST], false, NONE)).toBe(ACTIVE.id);
      expect(resolveCommissionSource(undefined, [PAST], false, NONE)).toBe(PAST.id);
    });

    it('is the first listed tariff when none has a week', () => {
      const first = tariff('t-first', null, null);
      const second = tariff('t-second', null, null);
      expect(resolveCommissionSource(undefined, [first, second], false, NONE)).toBe(first.id);
    });

    it('is nothing for an empty list', () => {
      expect(resolveCommissionSource(undefined, [], false, NONE)).toBeUndefined();
    });
  });
});
