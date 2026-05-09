/**
 * Integration tests for GET /v1/organizations/:orgId/fx-rates/latest (Task 6.3).
 *
 * Returns { USD: { rate, date, source } | null, EUR: { rate, date, source } | null }
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

type FxRateEntry = { rate: string; date: string; source: string };
type FxRatesBody = { USD: FxRateEntry | null; EUR: FxRateEntry | null };

async function callLatest(
  accessToken: string,
  orgId: string,
): Promise<{ status: number; body: FxRatesBody }> {
  const res = await app.request(`/v1/organizations/${orgId}/fx-rates/latest`, {
    headers: { Authorization: bearer(accessToken) },
  });
  const body = (await res.json()) as FxRatesBody;
  return { status: res.status, body };
}

async function seedFxRate(currency: 'USD' | 'EUR', rateToTry: string, rateDate: Date) {
  return prisma.fxRate.create({
    data: { currency, rateToTry: new Decimal(rateToTry), rateDate, source: 'TCMB' },
  });
}

describe('GET /v1/organizations/:orgId/fx-rates/latest', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const org = await createOrganization();
    const res = await app.request(`/v1/organizations/${org.id}/fx-rates/latest`);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a member', async () => {
    const user = await createAuthenticatedTestUser();
    const otherOrg = await createOrganization();
    const { status } = await callLatest(user.accessToken, otherOrg.id);
    expect(status).toBe(403);
  });

  it('returns nulls when no rates have been fetched', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const { status, body } = await callLatest(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.USD).toBeNull();
    expect(body.EUR).toBeNull();
  });

  it('returns the latest rate per currency', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const older = new Date('2026-05-07');
    const newer = new Date('2026-05-09');

    await seedFxRate('USD', '37.80', older);
    await seedFxRate('USD', '38.52', newer);
    await seedFxRate('EUR', '42.10', newer);

    const { status, body } = await callLatest(user.accessToken, org.id);
    expect(status).toBe(200);

    // USD: should return the newer row, not the older one
    expect(body.USD).not.toBeNull();
    expect(body.USD?.rate).toBe('38.52');
    expect(body.USD?.date).toBe('2026-05-09');
    expect(body.USD?.source).toBe('TCMB');

    // EUR: single row
    expect(body.EUR).not.toBeNull();
    // Decimal.js .toString() strips trailing zeros, so seeded "42.10" comes
    // back as "42.1". Both are mathematically equal; assert the canonical form.
    expect(body.EUR?.rate).toBe('42.1');
    expect(body.EUR?.date).toBe('2026-05-09');
    expect(body.EUR?.source).toBe('TCMB');
  });

  it('returns null for a currency with no rate even when another has one', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    await seedFxRate('USD', '38.00', new Date());

    const { status, body } = await callLatest(user.accessToken, org.id);
    expect(status).toBe(200);
    expect(body.USD).not.toBeNull();
    expect(body.EUR).toBeNull();
  });
});
