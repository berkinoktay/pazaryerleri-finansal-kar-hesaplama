// Focused integration test for the Plus commission-tariff import's
// one-tariff-per-week guard. A Plus upload's week window is [min period start …
// max period end]. A new upload whose window OVERLAPS an existing tariff's window
// for the store is rejected (422 VALIDATION_ERROR, field `file`, code
// `DUPLICATE_TARIFF_WEEK`). Back-to-back weeks only TOUCH (the previous week ends
// 07.59, the next starts 08.00 — a 1-minute gap), so they do NOT overlap and are
// allowed.
//
// The real Trendyol Plus fixture's single period is "30 Haziran 08.00-7 Temmuz
// 07.59", which parses to a concrete week window — so uploading it twice into one
// store is a guaranteed self-overlap, and a neighbour ending exactly where it
// begins is the back-to-back boundary case.

import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { findOverlappingWeek } from '@/workbooks/tariff-week';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

// The week overlap query, wrapped in a spy that runs the real query: the persist
// re-check case answers one call itself (see that case). Every other case runs it as is.
vi.mock('@/workbooks/tariff-week', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/workbooks/tariff-week')>();
  return { ...actual, findOverlappingWeek: vi.fn(actual.findOverlappingWeek) };
});

const app = createApp();

const FIXTURE = readFileSync(new URL('../../fixtures/trendyol-plus-tariff.xlsx', import.meta.url));

const WEEK_MS = 7 * 86_400_000;
const ONE_MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

interface ImportWire {
  tariffId: string;
}

interface ValidationWire {
  code: string;
  errors: { field: string; code: string }[];
}

async function setupStore(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

function importRequest(ctx: Ctx): Request {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol-plus-tariff.xlsx');
  return new Request(
    `http://local/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/plus-commission-tariffs/import`,
    { method: 'POST', headers: { Authorization: bearer(ctx.accessToken) }, body: form },
  );
}

describe('plus-commission-tariffs import — one-tariff-per-week overlap guard', () => {
  beforeEach(async () => {
    await ensureDbReachable();
    await truncateAll();
  });

  it('rejects a second upload of the same week with DUPLICATE_TARIFF_WEEK', async () => {
    const ctx = await setupStore();

    const first = await app.request(importRequest(ctx));
    expect(first.status).toBe(201);

    // The same fixture again → identical week window → self-overlap → rejected.
    const second = await app.request(importRequest(ctx));
    expect(second.status).toBe(422);
    const body = (await second.json()) as ValidationWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors[0]?.field).toBe('file');
    expect(body.errors[0]?.code).toBe('DUPLICATE_TARIFF_WEEK');
  });

  it('allows a back-to-back (1-minute-gap) week', async () => {
    // Learn the fixture's computed week window by importing into a probe store.
    const probe = await setupStore();
    const probeRes = await app.request(importRequest(probe));
    expect(probeRes.status).toBe(201);
    const { tariffId } = (await probeRes.json()) as ImportWire;
    const window = await prisma.plusCommissionTariff.findUnique({
      where: { id: tariffId },
      select: { weekStartsAt: true, weekEndsAt: true },
    });
    const start = window?.weekStartsAt ?? null;
    if (start === null) {
      throw new Error('fixture week did not parse — the overlap guard cannot be exercised');
    }

    // A fresh store holds ONLY the PREVIOUS week, ending one minute before this week
    // begins (…07.59 vs …08.00). Adjacent ranges touch but do not overlap.
    const ctx = await setupStore();
    await prisma.plusCommissionTariff.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: 'Önceki Hafta',
        weekStartsAt: new Date(start.getTime() - WEEK_MS),
        weekEndsAt: new Date(start.getTime() - ONE_MINUTE_MS),
      },
    });

    const res = await app.request(importRequest(ctx));
    expect(res.status).toBe(201);
  });

  // The persist re-check. The unique index only refuses an equal week_starts_at, so a
  // committed tariff whose week overlaps with a different start is caught by the overlap
  // query alone. Two concurrent uploads both pass the inspect pre-check before either
  // commits; this case recreates that honestly: the tariff is committed first, and the
  // first overlap query of the upload (the inspect pre-check, made with prisma) answers
  // null. The second one, persist's re-check inside the import transaction, runs the real
  // query and must refuse the upload with nothing written.
  it('refuses an overlapping week with another start in the import transaction, writing nothing', async () => {
    const probe = await setupStore();
    const probeRes = await app.request(importRequest(probe));
    expect(probeRes.status).toBe(201);
    const probeWeek = await prisma.plusCommissionTariff.findFirst({
      where: { organizationId: probe.orgId, storeId: probe.storeId },
      select: { weekStartsAt: true, weekEndsAt: true },
    });
    const start = probeWeek?.weekStartsAt ?? null;
    const end = probeWeek?.weekEndsAt ?? null;
    if (start === null || end === null) {
      throw new Error('fixture week did not parse: the overlap re-check cannot be exercised');
    }

    const ctx = await setupStore();
    const scope = { organizationId: ctx.orgId, storeId: ctx.storeId };
    const overlapping = await prisma.plusCommissionTariff.create({
      data: {
        ...scope,
        name: 'Overlapping week',
        weekStartsAt: new Date(start.getTime() + DAY_MS),
        weekEndsAt: new Date(end.getTime() + DAY_MS),
      },
      select: { id: true },
    });

    const overlapQuery = vi.mocked(findOverlappingWeek);
    overlapQuery.mockClear();
    overlapQuery.mockImplementationOnce(async () => null);

    const res = await app.request(importRequest(ctx));

    expect(res.status).toBe(422);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'file', code: 'DUPLICATE_TARIFF_WEEK' }],
    });
    // The inspect call answered null; the persist re-check found the committed tariff.
    expect(overlapQuery).toHaveBeenCalledTimes(2);
    expect(overlapQuery.mock.settledResults).toEqual([
      { type: 'fulfilled', value: null },
      { type: 'fulfilled', value: { id: overlapping.id } },
    ]);
    expect(await prisma.plusCommissionTariff.count({ where: scope })).toBe(1);
    expect(await prisma.plusCommissionTariffPeriod.count({ where: scope })).toBe(0);
    expect(await prisma.plusCommissionTariffItem.count({ where: scope })).toBe(0);
  });
});
