// Integration tests for resolveCommissionSource - the Advantage vertical's period
// picker. Runs against the real commission-tariff tables because the function does a
// couple of Prisma findMany calls; there is no value in mocking Prisma for that volume.
//
// The picker chooses, among the PINNED commission tariff's periods (ordered by
// sortOrder):
//   1. the sub-period ACTIVE at the real instant (converted, half-open [start, end)),
//   2. else the NEXT upcoming period (earliest converted start strictly after now),
//   3. else the LAST period (highest sortOrder) as a fully-past fallback.
//
// Period bounds are stored as Istanbul wall-clock saved verbatim as UTC, while `now`
// is a true instant. Istanbul runs UTC+3, so the real instant a bound denotes is ~3h
// BEFORE the stored value. The fixtures put the critical bounds only 1-3h ahead of
// `now` (less than the 3h offset) so a raw stored-vs-now comparison would misclassify
// them and only the converted comparison gets them right. `now` is passed in, so the
// cases are deterministic; all dates are relative to it so the test never drifts.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { resolveCommissionSource } from '../../../src/services/advantage-tariff.service';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

const HOUR_MS = 60 * 60 * 1000;

interface PeriodSpec {
  readonly label: string;
  readonly sortOrder: number;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

describe('resolveCommissionSource - advantage period selection', () => {
  let orgId: string;
  let storeId: string;

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    const org = await createOrganization();
    const store = await createStore(org.id, { name: 'Advantage Source Store' });
    orgId = org.id;
    storeId = store.id;
  });

  /** Creates a pinned commission tariff with the given periods; returns its id. */
  async function createPinnedTariff(name: string, periods: readonly PeriodSpec[]): Promise<string> {
    const tariff = await prisma.commissionTariff.create({
      data: { organizationId: orgId, storeId, name },
    });
    for (const period of periods) {
      await prisma.commissionTariffPeriod.create({
        data: {
          organizationId: orgId,
          storeId,
          tariffId: tariff.id,
          dateRangeLabel: period.label,
          sortOrder: period.sortOrder,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
        },
      });
    }
    return tariff.id;
  }

  it('selects the advantage period active at the real instant', async () => {
    const now = new Date();
    const at = now.getTime();
    // Active: stored start now+1h reads 'upcoming' raw, but its real start (now-2h) is
    // already past -> active. A clearly-future period must NOT win over it.
    const tariffId = await createPinnedTariff('Aktif Secim', [
      {
        label: 'Aktif',
        sortOrder: 0,
        startsAt: new Date(at + 1 * HOUR_MS),
        endsAt: new Date(at + 10 * HOUR_MS),
      },
      {
        label: 'Gelecek',
        sortOrder: 1,
        startsAt: new Date(at + 20 * HOUR_MS),
        endsAt: new Date(at + 30 * HOUR_MS),
      },
    ]);

    const resolved = await resolveCommissionSource(orgId, storeId, tariffId, now);
    expect(resolved).not.toBeNull();
    expect(resolved?.periodLabel).toBe('Aktif');
  });

  it('treats the advantage period end as exclusive', async () => {
    // Floor `now` to a whole second: the business-timezone conversion truncates sub-second
    // components, so an EXACT-boundary case (the period edge sitting precisely on `now`)
    // must avoid sub-second noise to compare deterministically.
    const at = Math.floor(Date.now() / 1000) * 1000;
    const now = new Date(at);
    // Two adjacent periods meet at the real instant `now` (stored boundary now+3h). On a
    // half-open [start, end) interval the period ENDING at now excludes it and the period
    // STARTING at now includes it, so the picker must choose 'Sonraki'.
    const tariffId = await createPinnedTariff('Sinir Secim', [
      {
        label: 'Onceki',
        sortOrder: 0,
        startsAt: new Date(at + 1 * HOUR_MS), // real now-2h
        endsAt: new Date(at + 3 * HOUR_MS), // real now
      },
      {
        label: 'Sonraki',
        sortOrder: 1,
        startsAt: new Date(at + 3 * HOUR_MS), // real now
        endsAt: new Date(at + 5 * HOUR_MS), // real now+2h
      },
    ]);

    const resolved = await resolveCommissionSource(orgId, storeId, tariffId, now);
    expect(resolved?.periodLabel).toBe('Sonraki');
  });

  it('falls back to the next upcoming period, then the last one', async () => {
    const now = new Date();
    const at = now.getTime();

    // No active period -> pick the nearest upcoming by CONVERTED start, not sortOrder:
    // 'Yakin' (real start now+2h) beats 'Uzak' (real start now+10h) despite a later sortOrder.
    const upcomingTariff = await createPinnedTariff('Yaklasan Secim', [
      {
        label: 'Uzak',
        sortOrder: 0,
        startsAt: new Date(at + 13 * HOUR_MS),
        endsAt: new Date(at + 15 * HOUR_MS),
      },
      {
        label: 'Yakin',
        sortOrder: 1,
        startsAt: new Date(at + 5 * HOUR_MS),
        endsAt: new Date(at + 7 * HOUR_MS),
      },
    ]);
    const upcoming = await resolveCommissionSource(orgId, storeId, upcomingTariff, now);
    expect(upcoming?.periodLabel).toBe('Yakin');

    // No active and no upcoming (every period fully past) -> the LAST period by sortOrder.
    const pastTariff = await createPinnedTariff('Gecmis Secim', [
      {
        label: 'Ilk',
        sortOrder: 0,
        startsAt: new Date(at - 7 * HOUR_MS),
        endsAt: new Date(at - 5 * HOUR_MS),
      },
      {
        label: 'Son',
        sortOrder: 1,
        startsAt: new Date(at - 3 * HOUR_MS),
        endsAt: new Date(at - 1 * HOUR_MS),
      },
    ]);
    const past = await resolveCommissionSource(orgId, storeId, pastTariff, now);
    expect(past?.periodLabel).toBe('Son');
  });

  it('ignores a period with null bounds for active/upcoming, using it only as the last fallback', async () => {
    // A period can carry null bounds when its Trendyol date label was unparseable. The
    // picker requires both bounds to match "active" and a start to match "upcoming", so a
    // null-bounded period is never chosen by either path - it only ever surfaces as the
    // final `periods.at(-1)` fallback. With a single null-bounded period, that is exactly
    // what resolves (and its startsAt/endsAt echo through as null).
    const now = new Date();
    const tariffId = await createPinnedTariff('Bos Sinir', [
      { label: 'Tarihsiz', sortOrder: 0, startsAt: null, endsAt: null },
    ]);

    const resolved = await resolveCommissionSource(orgId, storeId, tariffId, now);
    expect(resolved?.periodLabel).toBe('Tarihsiz');
    expect(resolved?.startsAt).toBeNull();
    expect(resolved?.endsAt).toBeNull();
  });
});
