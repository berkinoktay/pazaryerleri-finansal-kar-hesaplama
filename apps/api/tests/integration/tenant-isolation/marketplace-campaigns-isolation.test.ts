// Route-layer authorization for the WHOLE store-scoped Kampanyalar surface — all NINE
// endpoints: import (POST), list (GET), detail (GET), config (PATCH), selections (PATCH),
// estimate (POST), target-margin (POST), export (POST) and delete (DELETE).
//
// SECURITY.md §3 — existence non-disclosure: a cross-tenant storeId or campaignId returns 404
// (never 403), so an attacker cannot probe another tenant's ids by watching the status code.
// A non-member of the org gets 403; a request with no token gets 401.
//
// FOUR different gates answer four different attack shapes, and each needs its own fixture:
//
//   1. requireStoreAccess gate 1 — the caller is not a member of the org at all      → 403
//   2. requireStoreAccess gate 2 — the storeId in the path belongs to ANOTHER org    → 404
//   3. requireStoreAccess gate 3 — a MEMBER/VIEWER with no member_store_access grant → 404
//   4. the SERVICE's store-scoped `findFirst` — the caller legitimately reaches the store in
//      the path, but the campaign lives in a DIFFERENT store of the SAME org           → 404
//
// Shape 4 is the one no access gate can catch: with two stores in ONE org the caller really
// does have access to the store in the path, so `requireStoreAccess` passes cleanly and the
// `storeId` filter inside each service query is the ONLY thing between the request and
// another store's campaign. It is asserted on every campaign-scoped endpoint.
//
// A status alone is not enough for the write routes: a 404 that still WROTE would be the
// worst possible outcome and a status-only assertion would miss it. Every rejected request is
// therefore followed by a byte-identical comparison of the victim store's entire campaign
// state (campaign rows + their items), so an import that created, a PATCH that overwrote, an
// export that stamped `exportedAt` or a DELETE that removed would all fail here.
//
// Two vertical-specific proofs on top:
//   · the export streams a FILE — a leak hands over another seller's barcodes, product names
//     and cost-derived prices, so the rejection is proven to be problem+json and NOT a
//     spreadsheet, with the rightful owner's 200 in the same test as the vacuity guard;
//   · the campaign detail resolves commission bands from ANOTHER vertical (the commission
//     tariffs). Org A's campaign must never resolve against Org B's bands, even when both
//     carry the same barcode inside the same tariff week.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const testDir = path.dirname(fileURLToPath(import.meta.url));

// The real anonymized Trendyol campaign sheet. It is used BOTH as the import payload and as
// the victim campaign's stored source file, so a leaked export would hand back a genuine,
// re-uploadable spreadsheet carrying 68 rows of the victim's barcodes and product names —
// which is exactly what the export proof below has to rule out.
const FIXTURE = readFileSync(
  path.resolve(testDir, '../../fixtures/marketplace-campaign-sample.xlsx'),
);

// Both campaign dates are required by the config validator, and body/form validation runs
// BEFORE the store-access gate — a config the validator rejects would 422 before it could
// prove anything about tenant isolation.
const CAMPAIGN_WINDOW = {
  startsAt: '2026-09-10T09:00:00.000Z',
  endsAt: '2026-09-14T09:00:00.000Z',
} as const;

/** The config an attacker would send to overwrite the victim's campaign (valid on purpose). */
const HIJACK_CONFIG = {
  name: 'Hijacked',
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '99',
  trendyolFundingPct: '0',
  ...CAMPAIGN_WINDOW,
} as const;

// mode 'all' is the most destructive selections payload there is: it flips EVERY item of the
// campaign to MAX in a single statement without naming one itemId.
const HIJACK_SELECTIONS = { mode: 'all', selections: [] } as const;

/** The config that rides along with the multipart import upload. */
const IMPORT_CONFIG = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '10',
  trendyolFundingPct: '40',
  ...CAMPAIGN_WINDOW,
} as const;

const ESTIMATE_BODY = { scenario: 'max' } as const;
const TARGET_MARGIN_BODY = { targetMarginPct: '20' } as const;

// Victim campaign facts. The barcode and the title are data the attacker never supplies, so
// finding either in a response body is proof of disclosure.
const VICTIM_CAMPAIGN_NAME = 'Victim Campaign';
const VICTIM_BARCODE = 'CAMP-ISO-VICTIM-1';
const VICTIM_TITLE = 'Victim Campaign Product';
const VICTIM_CURRENT_PRICE = '250.00';
const VICTIM_MAX_PRICE = '200.00';
const VICTIM_FUNDING_PCT = '50';

// The barcode Org A's campaign item and Org B's commission band both carry in the
// cross-vertical proof — the collision that would leak if the band read were not store-scoped.
const SHARED_BARCODE = 'CAMP-ISO-SHARED';
// Commission tariff week bounds are persisted as Istanbul wall-clock-as-UTC; the campaign
// start (CAMPAIGN_WINDOW.startsAt) sits two days inside it, so the ±3h frame reconciliation
// cannot move the anchor out of the week.
const TARIFF_WEEK_START = new Date(Date.UTC(2026, 8, 8, 8, 0));
const TARIFF_WEEK_END = new Date(Date.UTC(2026, 8, 15, 8, 0));
const TARIFF_PERIOD_LABEL = '8 Eylul 08.00-15 Eylul 07.59';
// Org A's variant carries this as its SYNCED rate — the chain's 2nd tier. With no Org A band
// for the barcode the item must resolve here ('product'), which is provably NOT a band.
const SYNCED_COMMISSION_PCT = '19';

interface ProblemWire {
  readonly code: string;
}

interface SeededCampaign {
  readonly campaignId: string;
  readonly itemId: string;
}

/**
 * Seeds a one-item campaign owned by `storeId`, in the state that makes every attack below
 * maximally dangerous: the item already participates at MAX and the campaign keeps the real
 * Trendyol source file, so a leaked export returns an actual spreadsheet rather than a 409.
 */
async function seedCampaign(organizationId: string, storeId: string): Promise<SeededCampaign> {
  const list = await prisma.marketplaceCampaignList.create({
    data: {
      organizationId,
      storeId,
      name: VICTIM_CAMPAIGN_NAME,
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: new Decimal('10'),
      trendyolFundingPct: new Decimal(VICTIM_FUNDING_PCT),
      startsAt: new Date(CAMPAIGN_WINDOW.startsAt),
      endsAt: new Date(CAMPAIGN_WINDOW.endsAt),
      sourceFilename: 'trendyol_kampanya.xlsx',
      sourceFile: FIXTURE,
    },
  });
  const item = await prisma.marketplaceCampaignItem.create({
    data: {
      organizationId,
      storeId,
      listId: list.id,
      barcode: VICTIM_BARCODE,
      productTitle: VICTIM_TITLE,
      currentPrice: new Decimal(VICTIM_CURRENT_PRICE),
      maxPrice: new Decimal(VICTIM_MAX_PRICE),
      selection: 'MAX',
      sortOrder: 0,
    },
  });
  return { campaignId: list.id, itemId: item.id };
}

/**
 * Everything a leaked write could change about one store's campaigns, as a comparable string:
 * every campaign row's config + export marker and every item's price choice. Captured before
 * an attack and re-read after it, this is the "the 404 did not also write" evidence — an
 * import that created a row, a PATCH that overwrote one, an export that stamped `exportedAt`
 * or a DELETE that removed one all change this string.
 */
async function snapshotCampaignState(storeId: string): Promise<string> {
  const [lists, items] = await Promise.all([
    prisma.marketplaceCampaignList.findMany({
      where: { storeId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        organizationId: true,
        name: true,
        discountType: true,
        valueKind: true,
        value: true,
        minBasketAmount: true,
        minQuantity: true,
        buyQuantity: true,
        payQuantity: true,
        nthIndex: true,
        trendyolFundingPct: true,
        startsAt: true,
        endsAt: true,
        sourceFilename: true,
        exportedAt: true,
        updatedAt: true,
      },
    }),
    prisma.marketplaceCampaignItem.findMany({
      where: { storeId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        listId: true,
        barcode: true,
        currentPrice: true,
        maxPrice: true,
        selection: true,
        customPrice: true,
        updatedAt: true,
      },
    }),
  ]);
  return JSON.stringify({ lists, items });
}

interface Probe {
  readonly orgId: string;
  readonly storeId: string;
  readonly campaignId: string;
  readonly itemId: string;
  readonly token?: string;
}

interface CampaignEndpoint {
  /** Short label for the test title. */
  readonly label: string;
  /** `METHOD <templated path>` — matched against the OpenAPI spec so a 10th route can't hide. */
  readonly specKey: string;
  /** False for import + list: neither carries a campaignId, so a foreign-id probe is n/a. */
  readonly campaignScoped: boolean;
  readonly send: (probe: Probe) => Promise<Response>;
}

const SPEC_BASE = '/v1/organizations/{orgId}/stores/{storeId}/marketplace-campaigns';

function base(probe: Probe): string {
  return `/v1/organizations/${probe.orgId}/stores/${probe.storeId}/marketplace-campaigns`;
}

function authHeaders(
  token: string | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  return token === undefined ? extra : { ...extra, Authorization: bearer(token) };
}

async function sendJson(
  method: string,
  requestPath: string,
  token: string | undefined,
  body?: unknown,
): Promise<Response> {
  return app.request(requestPath, {
    method,
    headers: authHeaders(token, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * The multipart import, carrying the REAL vendor sheet plus a valid config — form validation
 * runs before the store-access gate, so anything less would 422 instead of reaching it. If
 * the gate ever leaked, this request would create a full 68-item campaign in the victim's
 * store, which the snapshot comparison would catch.
 */
async function sendImport(requestPath: string, token: string | undefined): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol_kampanya.xlsx');
  for (const [key, value] of Object.entries(IMPORT_CONFIG)) form.append(key, value);
  return app.request(
    new Request(`http://local${requestPath}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: form,
    }),
  );
}

const ENDPOINTS: readonly CampaignEndpoint[] = [
  {
    label: 'POST import',
    specKey: `POST ${SPEC_BASE}/import`,
    campaignScoped: false,
    send: (p) => sendImport(`${base(p)}/import`, p.token),
  },
  {
    label: 'GET list',
    specKey: `GET ${SPEC_BASE}`,
    campaignScoped: false,
    send: (p) => sendJson('GET', base(p), p.token),
  },
  {
    label: 'GET detail',
    specKey: `GET ${SPEC_BASE}/{campaignId}`,
    campaignScoped: true,
    send: (p) => sendJson('GET', `${base(p)}/${p.campaignId}`, p.token),
  },
  {
    label: 'PATCH config',
    specKey: `PATCH ${SPEC_BASE}/{campaignId}`,
    campaignScoped: true,
    send: (p) => sendJson('PATCH', `${base(p)}/${p.campaignId}`, p.token, HIJACK_CONFIG),
  },
  {
    label: 'PATCH selections',
    specKey: `PATCH ${SPEC_BASE}/{campaignId}/selections`,
    campaignScoped: true,
    send: (p) =>
      sendJson('PATCH', `${base(p)}/${p.campaignId}/selections`, p.token, HIJACK_SELECTIONS),
  },
  {
    label: 'POST estimate',
    specKey: `POST ${SPEC_BASE}/{campaignId}/items/{itemId}/estimate`,
    campaignScoped: true,
    send: (p) =>
      sendJson(
        'POST',
        `${base(p)}/${p.campaignId}/items/${p.itemId}/estimate`,
        p.token,
        ESTIMATE_BODY,
      ),
  },
  {
    label: 'POST target-margin',
    specKey: `POST ${SPEC_BASE}/{campaignId}/target-margin`,
    campaignScoped: true,
    send: (p) =>
      sendJson('POST', `${base(p)}/${p.campaignId}/target-margin`, p.token, TARGET_MARGIN_BODY),
  },
  {
    label: 'POST export',
    specKey: `POST ${SPEC_BASE}/{campaignId}/export`,
    campaignScoped: true,
    send: (p) => sendJson('POST', `${base(p)}/${p.campaignId}/export`, p.token),
  },
  {
    label: 'DELETE campaign',
    specKey: `DELETE ${SPEC_BASE}/{campaignId}`,
    campaignScoped: true,
    send: (p) => sendJson('DELETE', `${base(p)}/${p.campaignId}`, p.token),
  },
];

const CAMPAIGN_SCOPED_ENDPOINTS = ENDPOINTS.filter((endpoint) => endpoint.campaignScoped);

describe('marketplace-campaigns: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('covers every marketplace-campaign endpoint registered in the OpenAPI spec', () => {
    // Structural backstop: a tenth campaign route shipping without an isolation case fails
    // HERE rather than silently going uncovered. The GET-only backstop in
    // org-scoped-route-coverage cannot reach the POST/PATCH/DELETE half of this surface.
    const spec = JSON.parse(
      readFileSync(
        path.resolve(testDir, '../../../../../packages/api-client/openapi.json'),
        'utf8',
      ),
    ) as { paths: Record<string, Record<string, unknown>> };

    const registered = Object.entries(spec.paths)
      .filter(([routePath]) => routePath.includes('/marketplace-campaigns'))
      .flatMap(([routePath, ops]) =>
        Object.keys(ops).map((method) => `${method.toUpperCase()} ${routePath}`),
      )
      .sort();

    expect(registered).toEqual(ENDPOINTS.map((endpoint) => endpoint.specKey).sort());
  });

  // ─── Gate 2: a storeId belonging to another organization ────────────────────

  describe("a storeId from another organization, under the caller's own org", () => {
    it.each(ENDPOINTS)('$label returns 404 and writes nothing', async (endpoint) => {
      const caller = await createAuthenticatedTestUser();
      const orgA = await createOrganization();
      await createMembership(orgA.id, caller.id);

      const victimOrg = await createOrganization();
      const victimStore = await createStore(victimOrg.id);
      const victim = await seedCampaign(victimOrg.id, victimStore.id);

      const before = await snapshotCampaignState(victimStore.id);
      const res = await endpoint.send({
        orgId: orgA.id,
        storeId: victimStore.id,
        campaignId: victim.campaignId,
        itemId: victim.itemId,
        token: caller.accessToken,
      });

      expect(res.status).toBe(404);
      const body = await res.text();
      expect((JSON.parse(body) as ProblemWire).code).toBe('NOT_FOUND');
      expect(body).not.toContain(VICTIM_BARCODE);
      expect(body).not.toContain(VICTIM_TITLE);
      await expect(snapshotCampaignState(victimStore.id)).resolves.toBe(before);
    });
  });

  // ─── The service's store filter, across orgs ────────────────────────────────

  describe("a campaign id from another organization, under the caller's OWN store", () => {
    it.each(CAMPAIGN_SCOPED_ENDPOINTS)(
      '$label returns 404 and writes nothing',
      async (endpoint) => {
        const caller = await createAuthenticatedTestUser();
        const orgA = await createOrganization();
        await createMembership(orgA.id, caller.id);
        const callerStore = await createStore(orgA.id);

        const victimOrg = await createOrganization();
        const victimStore = await createStore(victimOrg.id);
        const victim = await seedCampaign(victimOrg.id, victimStore.id);

        const before = await snapshotCampaignState(victimStore.id);
        const res = await endpoint.send({
          orgId: orgA.id,
          storeId: callerStore.id,
          campaignId: victim.campaignId,
          itemId: victim.itemId,
          token: caller.accessToken,
        });

        expect(res.status).toBe(404);
        const body = await res.text();
        expect((JSON.parse(body) as ProblemWire).code).toBe('NOT_FOUND');
        expect(body).not.toContain(VICTIM_BARCODE);
        expect(body).not.toContain(VICTIM_TITLE);
        await expect(snapshotCampaignState(victimStore.id)).resolves.toBe(before);
      },
    );
  });

  // ─── The service's store filter, WITHIN one organization ────────────────────
  //
  // The highest-value case of the whole file: the caller is an OWNER, so they genuinely have
  // access to BOTH stores and `requireStoreAccess` passes on the store in the path. Only the
  // service's `storeId` filter separates the request from the sibling store's campaign.

  describe('a campaign id from a SIBLING store in the same organization', () => {
    it.each(CAMPAIGN_SCOPED_ENDPOINTS)(
      '$label returns 404 and writes nothing',
      async (endpoint) => {
        const caller = await createAuthenticatedTestUser();
        const org = await createOrganization();
        await createMembership(org.id, caller.id);
        const storeInPath = await createStore(org.id, { name: 'Store In Path' });
        const siblingStore = await createStore(org.id, { name: 'Sibling Store' });
        const victim = await seedCampaign(org.id, siblingStore.id);

        const before = await snapshotCampaignState(siblingStore.id);
        const res = await endpoint.send({
          orgId: org.id,
          storeId: storeInPath.id,
          campaignId: victim.campaignId,
          itemId: victim.itemId,
          token: caller.accessToken,
        });

        expect(res.status).toBe(404);
        const body = await res.text();
        expect((JSON.parse(body) as ProblemWire).code).toBe('NOT_FOUND');
        expect(body).not.toContain(VICTIM_BARCODE);
        expect(body).not.toContain(VICTIM_TITLE);
        await expect(snapshotCampaignState(siblingStore.id)).resolves.toBe(before);
      },
    );
  });

  // ─── Gate 3: a MEMBER with no member_store_access grant ─────────────────────

  describe('a MEMBER of the org with no access grant for the store', () => {
    it.each(ENDPOINTS)('$label returns 404 and writes nothing', async (endpoint) => {
      const caller = await createAuthenticatedTestUser();
      const org = await createOrganization();
      const membership = await createMembership(org.id, caller.id, 'MEMBER');
      const grantedStore = await createStore(org.id, { name: 'Granted' });
      const ungrantedStore = await createStore(org.id, { name: 'Ungranted' });
      await createMemberStoreAccess(org.id, membership.id, grantedStore.id);
      const victim = await seedCampaign(org.id, ungrantedStore.id);

      const before = await snapshotCampaignState(ungrantedStore.id);
      const res = await endpoint.send({
        orgId: org.id,
        storeId: ungrantedStore.id,
        campaignId: victim.campaignId,
        itemId: victim.itemId,
        token: caller.accessToken,
      });

      // An ungranted store is indistinguishable from a missing one — 404, never 403.
      expect(res.status).toBe(404);
      expect(((await res.json()) as ProblemWire).code).toBe('NOT_FOUND');
      await expect(snapshotCampaignState(ungrantedStore.id)).resolves.toBe(before);
    });
  });

  // ─── Gate 1 + auth middleware ───────────────────────────────────────────────

  describe('a caller outside the organization', () => {
    it.each(ENDPOINTS)(
      '$label rejects a non-member with 403 and an anonymous caller with 401',
      async (endpoint) => {
        const outsider = await createAuthenticatedTestUser();
        const org = await createOrganization();
        const store = await createStore(org.id);
        const victim = await seedCampaign(org.id, store.id);
        const probe = {
          orgId: org.id,
          storeId: store.id,
          campaignId: victim.campaignId,
          itemId: victim.itemId,
        };

        const before = await snapshotCampaignState(store.id);

        // Membership is checked before store existence, so a non-member gets 403 — the org
        // id was in their request, so no existence is disclosed by saying "not your org".
        const forbidden = await endpoint.send({ ...probe, token: outsider.accessToken });
        expect(forbidden.status).toBe(403);
        expect(((await forbidden.json()) as ProblemWire).code).toBe('FORBIDDEN');

        const anonymous = await endpoint.send(probe);
        expect(anonymous.status).toBe(401);

        await expect(snapshotCampaignState(store.id)).resolves.toBe(before);
      },
    );
  });

  // ─── Read-path scoping proofs ───────────────────────────────────────────────

  it("the list never returns a sibling store's or another org's campaigns", async () => {
    const caller = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, caller.id);
    const emptyStore = await createStore(org.id, { name: 'Empty' });
    const siblingStore = await createStore(org.id, { name: 'Sibling' });
    await seedCampaign(org.id, siblingStore.id);

    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);
    await seedCampaign(otherOrg.id, otherStore.id);

    const empty = await app.request(
      `/v1/organizations/${org.id}/stores/${emptyStore.id}/marketplace-campaigns`,
      { headers: { Authorization: bearer(caller.accessToken) } },
    );
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { data: unknown[] }).data).toHaveLength(0);

    // Vacuity guard: the same caller DOES see the sibling store's campaign through its own
    // path, so the empty result above is the store filter working, not a broken fixture.
    const sibling = await app.request(
      `/v1/organizations/${org.id}/stores/${siblingStore.id}/marketplace-campaigns`,
      { headers: { Authorization: bearer(caller.accessToken) } },
    );
    expect(sibling.status).toBe(200);
    expect(((await sibling.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it('target-margin on a foreign campaign discloses none of its items', async () => {
    const caller = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, caller.id);
    const callerStore = await createStore(orgA.id);

    const victimOrg = await createOrganization();
    const victimStore = await createStore(victimOrg.id);
    const victim = await seedCampaign(victimOrg.id, victimStore.id);

    // The itemId appears nowhere in this request — the endpoint takes only a campaign id and
    // answers with one suggestion per item, so leaking the id would leak the item roster.
    const res = await sendJson(
      'POST',
      `/v1/organizations/${orgA.id}/stores/${callerStore.id}/marketplace-campaigns/${victim.campaignId}/target-margin`,
      caller.accessToken,
      TARGET_MARGIN_BODY,
    );

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(victim.itemId);
    expect(body).not.toContain(VICTIM_BARCODE);
    expect(body).not.toContain(VICTIM_MAX_PRICE);
  });

  // ─── A foreign itemId smuggled into the caller's OWN campaign ───────────────
  //
  // The sharpest remaining shape: the caller owns the org, the store AND the campaign in the
  // path, so every access gate and the campaign-level store filter pass. Only the item-level
  // `listId` filter stands between the request and another tenant's item row.

  it("estimating a foreign itemId under the caller's OWN campaign returns 404", async () => {
    const caller = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, caller.id);
    const store = await createStore(org.id);
    const own = await seedCampaign(org.id, store.id);

    const victimOrg = await createOrganization();
    const victimStore = await createStore(victimOrg.id);
    const victim = await seedCampaign(victimOrg.id, victimStore.id);

    const res = await sendJson(
      'POST',
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${own.campaignId}/items/${victim.itemId}/estimate`,
      caller.accessToken,
      ESTIMATE_BODY,
    );

    expect(res.status).toBe(404);
    const body = await res.text();
    expect((JSON.parse(body) as ProblemWire).code).toBe('NOT_FOUND');
    expect(body).not.toContain(VICTIM_BARCODE);
    expect(body).not.toContain(VICTIM_TITLE);
  });

  it("a selections payload naming a foreign itemId writes nothing to the victim's item", async () => {
    const caller = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, caller.id);
    const store = await createStore(org.id);
    const own = await seedCampaign(org.id, store.id);

    const victimOrg = await createOrganization();
    const victimStore = await createStore(victimOrg.id);
    const victim = await seedCampaign(victimOrg.id, victimStore.id);

    const before = await snapshotCampaignState(victimStore.id);
    const res = await sendJson(
      'PATCH',
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${own.campaignId}/selections`,
      caller.accessToken,
      {
        mode: 'set',
        selections: [{ itemId: victim.itemId, selection: 'CUSTOM', customPrice: '1.00' }],
      },
    );

    // The bulk UPDATE is gated on (organization_id, store_id, list_id), so a foreign itemId is
    // silently skipped rather than rejected: the request succeeds having changed NOTHING.
    // That is the documented contract — what matters here is that `updated` is 0 and the
    // victim's row is untouched, NOT that the caller learns the id was foreign.
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
    await expect(snapshotCampaignState(victimStore.id)).resolves.toBe(before);
  });

  // ─── The export is a FILE — prove no spreadsheet crosses the boundary ────────

  it('a cross-tenant export returns problem+json and never the victim spreadsheet', async () => {
    const attacker = await createAuthenticatedTestUser();
    const attackerOrg = await createOrganization();
    await createMembership(attackerOrg.id, attacker.id);
    const attackerStore = await createStore(attackerOrg.id);

    const victimUser = await createAuthenticatedTestUser();
    const victimOrg = await createOrganization();
    await createMembership(victimOrg.id, victimUser.id);
    const victimStore = await createStore(victimOrg.id);
    const victim = await seedCampaign(victimOrg.id, victimStore.id);

    const attacks = [
      // The victim's storeId under the attacker's org path.
      `/v1/organizations/${attackerOrg.id}/stores/${victimStore.id}/marketplace-campaigns/${victim.campaignId}/export`,
      // The victim's campaignId under the attacker's OWN store.
      `/v1/organizations/${attackerOrg.id}/stores/${attackerStore.id}/marketplace-campaigns/${victim.campaignId}/export`,
    ];

    for (const attack of attacks) {
      const res = await sendJson('POST', attack, attacker.accessToken);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type') ?? '').not.toContain('spreadsheetml');
      expect(res.headers.get('content-disposition')).toBeNull();

      const raw = Buffer.from(await res.arrayBuffer());
      // Every .xlsx is a ZIP container and starts with the "PK" local-file signature.
      expect(raw.subarray(0, 2).toString('latin1')).not.toBe('PK');
      expect((JSON.parse(raw.toString('utf8')) as ProblemWire).code).toBe('NOT_FOUND');
    }

    // Not merely unread — unmarked: the export stamps `exportedAt`, and neither attack did.
    const untouched = await prisma.marketplaceCampaignList.findUnique({
      where: { id: victim.campaignId },
      select: { exportedAt: true },
    });
    expect(untouched?.exportedAt).toBeNull();

    // Vacuity guard: the SAME request from the rightful owner does return the spreadsheet, so
    // the 404s above are the tenant gate — not a fixture that could never export at all.
    const beforeOwnerExport = await snapshotCampaignState(victimStore.id);
    const owner = await sendJson(
      'POST',
      `/v1/organizations/${victimOrg.id}/stores/${victimStore.id}/marketplace-campaigns/${victim.campaignId}/export`,
      victimUser.accessToken,
    );
    expect(owner.status).toBe(200);
    const ownerFile = Buffer.from(await owner.arrayBuffer());
    expect(ownerFile.subarray(0, 2).toString('latin1')).toBe('PK');

    // Second vacuity guard, this one for the no-mutation apparatus itself: the export marks
    // the campaign, so a REAL write moves the snapshot. That is what makes every
    // "resolves.toBe(before)" above evidence rather than a tautology.
    await expect(snapshotCampaignState(victimStore.id)).resolves.not.toBe(beforeOwnerExport);
  });

  // ─── Cross-vertical: campaign bands never come from another org's tariffs ────

  it("a campaign never resolves its commission from another org's tariff bands", async () => {
    await ensureFeeDefinitions();

    // ─── Org A: a campaign item matched to a variant whose SYNCED rate is the chain's 2nd
    //     tier. Org A's OWN commission week covers the campaign start but holds NO band for
    //     this barcode, so the item must resolve to 'product', never to a band. ───
    const caller = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, caller.id);
    const storeA = await createStore(orgA.id);

    const productA = await createProduct(orgA.id, storeA.id, { title: 'Campaign Isolation' });
    const variantA = await createProductVariant(orgA.id, storeA.id, productA.id, {
      barcode: SHARED_BARCODE,
      salePrice: '360.00',
    });
    await prisma.productVariant.update({
      where: { id: variantA.id },
      data: { syncedCommissionRate: new Decimal(SYNCED_COMMISSION_PCT) },
    });

    const tariffA = await prisma.commissionTariff.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A Commission',
        weekStartsAt: TARIFF_WEEK_START,
        weekEndsAt: TARIFF_WEEK_END,
      },
    });
    await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        tariffId: tariffA.id,
        dateRangeLabel: TARIFF_PERIOD_LABEL,
        dayCount: 7,
        startsAt: TARIFF_WEEK_START,
        endsAt: TARIFF_WEEK_END,
        sortOrder: 0,
      },
    });

    const campaignA = await prisma.marketplaceCampaignList.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A Campaign',
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('20'),
        trendyolFundingPct: new Decimal('0'),
        startsAt: new Date(CAMPAIGN_WINDOW.startsAt),
        endsAt: new Date(CAMPAIGN_WINDOW.endsAt),
      },
    });
    const itemA = await prisma.marketplaceCampaignItem.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        listId: campaignA.id,
        productVariantId: variantA.id,
        barcode: SHARED_BARCODE,
        productTitle: 'Campaign Isolation',
        currentPrice: new Decimal('360.00'),
        maxPrice: new Decimal('288.00'),
        sortOrder: 0,
      },
    });

    // ─── Org B: the same week WITH a band for the SAME barcode. If the band read leaked
    //     across tenants, both scenarios would land in an Org B band and report 'band'. ───
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await prisma.commissionTariff.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        name: 'Org B Commission',
        weekStartsAt: TARIFF_WEEK_START,
        weekEndsAt: TARIFF_WEEK_END,
      },
    });
    const periodB = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        tariffId: tariffB.id,
        dateRangeLabel: TARIFF_PERIOD_LABEL,
        dayCount: 7,
        startsAt: TARIFF_WEEK_START,
        endsAt: TARIFF_WEEK_END,
        sortOrder: 0,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        periodId: periodB.id,
        barcode: SHARED_BARCODE,
        productTitle: 'Campaign Isolation',
        currentPrice: '360.00',
        currentCommissionPct: '0.1900',
        bands: [
          { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
          { key: 'band2', lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5' },
          { key: 'band3', upperLimit: '249.99', commissionPct: '8' },
        ],
        sortOrder: 0,
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/marketplace-campaigns/${campaignA.id}`,
      { headers: { Authorization: bearer(caller.accessToken) } },
    );
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      commissionTariffName: string | null;
      items: {
        id: string;
        commissionBands: unknown[] | null;
        current: { commissionSource: string | null };
        maxScenario: { commissionSource: string | null };
      }[];
    };

    // The campaign resolved against Org A's OWN week (vacuity guard: a week WAS resolved, so
    // "no band" below is the barcode missing from Org A's tariff — not the anchor missing a
    // covering week entirely).
    expect(detail.commissionTariffName).toBe('Org A Commission');

    const item = detail.items.find((i) => i.id === itemA.id);
    expect(item?.current.commissionSource).toBe('product');
    expect(item?.maxScenario.commissionSource).toBe('product');
    expect(item?.current.commissionSource).not.toBe('band');
    expect(item?.maxScenario.commissionSource).not.toBe('band');
    // Org B's ladder must not surface in the popover payload either.
    expect(item?.commissionBands).toBeNull();
  });

  it('a random campaign id in the caller OWN store is the same 404 as a foreign one', async () => {
    // Non-disclosure means the two are indistinguishable: this pins that the foreign-campaign
    // 404s above carry the same code as a genuinely missing id.
    const caller = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, caller.id);
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${randomUUID()}`,
      { headers: { Authorization: bearer(caller.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProblemWire).code).toBe('NOT_FOUND');
  });
});
