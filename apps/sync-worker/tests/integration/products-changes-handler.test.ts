// Integration test for the chunked PRODUCTS_CHANGES handler: the hourly
// date-window walk of the approved product list. One invocation = one page of
// one phase; the first invocation only anchors the window and stores it.
//
// Trendyol is mocked with vi.spyOn(globalThis, 'fetch'), the repo convention
// for backend tests, routed by the request's (dateQueryType, page) pair so the
// multi-phase cases do not depend on call order. Prior runs that anchor the
// window are seeded straight into sync_logs. The window durations come from
// the handler's own constants (the pure unit test pins their values); these
// tests pin the wiring: DB anchor -> window -> cursor -> Trendyol query -> rows.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import type { SyncLog, SyncStatus, SyncType } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import {
  encryptCredentials,
  syncLog,
  tryClaimNext,
  type ProductsChangesCursor,
  type ProductsChangesPhase,
} from '@pazarsync/sync-core';

import {
  processProductsChangesChunk,
  productsChangesHandler,
} from '../../src/handlers/products-changes';
import {
  PRODUCTS_CHANGES_CREATED_LOOKBACK_MS,
  PRODUCTS_CHANGES_END_ALLOWANCE_MS,
  PRODUCTS_CHANGES_MAX_LOOKBACK_MS,
  PRODUCTS_CHANGES_SAFETY_MARGIN_MS,
} from '../../src/handlers/products-changes-window';
import { runSyncToCompletion } from '../../src/loop';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

// --- Constants ----------------------------------------------------------------

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const WORKER_ID = 'worker-test';
const SUPPLIER_ID = '2738';
const OTHER_SUPPLIER_ID = '9999';

// How long after its start a seeded prior run is stamped COMPLETED / FAILED.
const SEEDED_RUN_DURATION_MS = MS_PER_MINUTE;

// How long before "now" a test's PRODUCTS_CHANGES run started (its windowEnd).
const RUN_AGE_MS = MS_PER_MINUTE;

// Trendyol's approved list pages by `page` only up to this many items.
const APPROVED_PAGE_CAP_ITEMS = 10_000;
const PAGE_SIZE = 100;
const LAST_PAGE_UNDER_CAP = APPROVED_PAGE_CAP_ITEMS / PAGE_SIZE - 1;

// A lastSyncedAt safely before any run in these tests: "no approved read
// returned this variant since".
const STALE_LAST_SYNCED_AT = new Date('2020-01-01T00:00:00.000Z');

const LOCK_REASON = 'CRITICAL_SALE_PRICE_CHANGE';

// Query params the date-window fetcher must never send.
const FORBIDDEN_QUERY_PARAMS = ['status', 'nextPageToken', 'orderByDirection'] as const;

// --- Trendyol fixtures ----------------------------------------------------------

interface VariantSpec {
  variantId: number;
  quantity?: number;
  salePrice?: number;
  dimensionalWeight?: number;
  onSale?: boolean;
  locked?: boolean;
  lockReason?: string | null;
  archived?: boolean;
}

interface ContentSpec {
  contentId: number;
  title?: string;
  imageUrls?: string[];
  variants: VariantSpec[];
}

function buildContent(spec: ContentSpec): unknown {
  return {
    contentId: spec.contentId,
    productMainId: `pm-${spec.contentId.toString()}`,
    brand: { id: 100, name: 'TestBrand' },
    category: { id: 200, name: 'TestCategory' },
    creationDate: 1777246115403,
    lastModifiedDate: 1777246115403,
    title: spec.title ?? `Product ${spec.contentId.toString()}`,
    description: 'desc',
    images: (spec.imageUrls ?? [`https://cdn.example.com/${spec.contentId.toString()}.jpg`]).map(
      (url) => ({ url }),
    ),
    attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
    variants: spec.variants.map((v) => ({
      variantId: v.variantId,
      supplierId: Number(SUPPLIER_ID),
      barcode: `bc-${v.variantId.toString()}`,
      attributes: [],
      onSale: v.onSale ?? true,
      deliveryOptions: { deliveryDuration: 1 },
      stock: { quantity: v.quantity ?? 10, lastModifiedDate: 0 },
      price: { salePrice: v.salePrice ?? 100, listPrice: v.salePrice ?? 100 },
      stockCode: `sk-${v.variantId.toString()}`,
      vatRate: 20,
      locked: v.locked ?? false,
      ...(v.lockReason !== undefined ? { lockReason: v.lockReason } : {}),
      archived: v.archived ?? false,
      blacklisted: false,
      ...(v.dimensionalWeight !== undefined ? { dimensionalWeight: v.dimensionalWeight } : {}),
    })),
  };
}

// One single-variant content per id; the shape the phase-walk cases need.
function contentsOf(contentIds: number[]): unknown[] {
  return contentIds.map((contentId) =>
    buildContent({ contentId, variants: [{ variantId: contentId * 10 }] }),
  );
}

interface PageMeta {
  totalElements: number;
  totalPages: number;
  page: number;
  // Trendyol sends it only when there is more than one page. The handler
  // must never follow it; a multi-page fixture carries one to prove that.
  nextPageToken?: string;
}

function approvedPage(content: unknown[] | null, meta: PageMeta): unknown {
  return {
    totalElements: meta.totalElements,
    totalPages: meta.totalPages,
    page: meta.page,
    size: PAGE_SIZE,
    ...(meta.nextPageToken !== undefined ? { nextPageToken: meta.nextPageToken } : {}),
    content,
  };
}

function emptyPage(page: number): unknown {
  return approvedPage([], { totalElements: 0, totalPages: 0, page });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Fetch router ---------------------------------------------------------------

// Sentinel route value: answer this (phase, page) with a 404.
const NOT_FOUND = Symbol('not-found');

// Every request must hit the approved endpoint of the job store's seller.
// Pins the endpoint and the credentials the handler picked: the tenant test
// has a sibling store under OTHER_SUPPLIER_ID.
const APPROVED_PATH = `/integration/product/sellers/${SUPPLIER_ID}/products/approved`;

function pageKey(phase: ProductsChangesPhase, page: number): string {
  return `${phase}:${page.toString()}`;
}

// The pageKey a Trendyol request asks for.
function routeKeyOf(url: URL): string {
  return `${url.searchParams.get('dateQueryType') ?? ''}:${url.searchParams.get('page') ?? ''}`;
}

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

interface ApprovedPageRouter {
  requests: URL[];
  // Requests no route matched, or sent to any path but APPROVED_PATH. They
  // answer 400 (non-retryable), so the handler fails fast instead of sitting
  // in fetchOnce's network backoff.
  unexpected: string[];
}

// Routes map pageKey(phase, page) to a response body, or to NOT_FOUND.
function routeApprovedPages(routes: Record<string, unknown>): ApprovedPageRouter {
  const router: ApprovedPageRouter = { requests: [], unexpected: [] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = requestUrl(input);
    router.requests.push(url);
    const key = routeKeyOf(url);
    if (url.pathname !== APPROVED_PATH) {
      router.unexpected.push(`${url.pathname} ${key}`);
      return jsonResponse({ errors: [{ message: 'unexpected test path' }] }, 400);
    }
    const body = routes[key];
    if (body === undefined) {
      router.unexpected.push(key);
      return jsonResponse({ errors: [{ message: 'unexpected test request' }] }, 400);
    }
    if (body === NOT_FOUND) return jsonResponse({ errors: [{ message: 'not found' }] }, 404);
    return jsonResponse(body);
  });
  return router;
}

interface QueryParams {
  key: string;
  startDate: number;
  endDate: number;
}

function queryParamsOf(url: URL): QueryParams {
  return {
    key: routeKeyOf(url),
    startDate: Number(url.searchParams.get('startDate')),
    endDate: Number(url.searchParams.get('endDate')),
  };
}

// --- DB helpers -----------------------------------------------------------------

async function createTestStore(
  orgId: string,
  opts?: { externalAccountId?: string; name?: string },
): Promise<string> {
  const externalAccountId = opts?.externalAccountId ?? SUPPLIER_ID;
  const store = await prisma.store.create({
    data: {
      organizationId: orgId,
      name: opts?.name ?? 'Test Trendyol Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId,
      credentials: encryptCredentials({
        supplierId: externalAccountId,
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret',
      }),
    },
  });
  return store.id;
}

async function setupTenant(opts?: {
  externalAccountId?: string;
}): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const storeId = await createTestStore(org.id, opts);
  return { orgId: org.id, storeId };
}

// A finished prior run, the kind the window anchors on (COMPLETED) or must
// ignore (FAILED). Both carry completedAt so the anchor's status filter, not a
// missing timestamp, is what excludes a FAILED row.
async function seedFinishedRun(opts: {
  orgId: string;
  storeId: string;
  syncType: SyncType;
  status: Extract<SyncStatus, 'COMPLETED' | 'FAILED'>;
  startedAt: Date;
}): Promise<void> {
  await prisma.syncLog.create({
    data: {
      organizationId: opts.orgId,
      storeId: opts.storeId,
      syncType: opts.syncType,
      status: opts.status,
      startedAt: opts.startedAt,
      completedAt: new Date(opts.startedAt.getTime() + SEEDED_RUN_DURATION_MS),
    },
  });
}

// The claimed PRODUCTS_CHANGES row a chunk runs for.
async function createChangesLog(opts: {
  orgId: string;
  storeId: string;
  startedAt: Date;
  progressCurrent?: number;
}): Promise<SyncLog> {
  return prisma.syncLog.create({
    data: {
      organizationId: opts.orgId,
      storeId: opts.storeId,
      syncType: 'PRODUCTS_CHANGES',
      status: 'RUNNING',
      startedAt: opts.startedAt,
      claimedAt: new Date(),
      claimedBy: WORKER_ID,
      lastTickAt: new Date(),
      attemptCount: 1,
      progressCurrent: opts.progressCurrent ?? 0,
    },
  });
}

interface SeedVariantSpec {
  variantId: number;
  quantity: number;
  salePrice: string;
  delistedAt?: Date | null;
}

// Plants a product and its variants directly (no scan), every row stamped
// with STALE_LAST_SYNCED_AT so a write by the handler is detectable.
async function seedProduct(opts: {
  orgId: string;
  storeId: string;
  contentId: number;
  title: string;
  variants: SeedVariantSpec[];
}): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: opts.orgId,
      storeId: opts.storeId,
      platformContentId: BigInt(opts.contentId),
      productMainId: `pm-${opts.contentId.toString()}`,
      title: opts.title,
      imageUrls: [`https://cdn.example.com/seed-${opts.contentId.toString()}.jpg`],
      lastSyncedAt: STALE_LAST_SYNCED_AT,
    },
  });
  for (const v of opts.variants) {
    await prisma.productVariant.create({
      data: {
        organizationId: opts.orgId,
        storeId: opts.storeId,
        productId: product.id,
        platformVariantId: BigInt(v.variantId),
        barcode: `bc-${v.variantId.toString()}`,
        stockCode: `sk-${v.variantId.toString()}`,
        salePrice: v.salePrice,
        listPrice: v.salePrice,
        quantity: v.quantity,
        status: ProductVariantStatus.ON_SALE,
        lastSyncedAt: STALE_LAST_SYNCED_AT,
        delistedAt: v.delistedAt ?? null,
      },
    });
  }
  return product.id;
}

async function variantOf(storeId: string, variantId: number) {
  return prisma.productVariant.findUniqueOrThrow({
    where: { storeId_platformVariantId: { storeId, platformVariantId: BigInt(variantId) } },
  });
}

async function productOf(storeId: string, contentId: number) {
  return prisma.product.findUniqueOrThrow({
    where: { storeId_platformContentId: { storeId, platformContentId: BigInt(contentId) } },
  });
}

// --- Window expectations ----------------------------------------------------------

function cursorFor(
  phase: ProductsChangesPhase,
  page: number,
  window: { windowStart: number; windowEnd: number },
): ProductsChangesCursor {
  return { phase, page, ...window };
}

function runStartedAtNow(): Date {
  return new Date(Date.now() - RUN_AGE_MS);
}

describe('processProductsChangesChunk', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('window anchoring (first chunk)', () => {
    it('first run: anchors on the last COMPLETED full scan and stores the window before any vendor call', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const fullScanStartedAt = new Date(runStartedAt.getTime() - 3 * MS_PER_HOUR);
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: fullScanStartedAt,
      });
      const router = routeApprovedPages({});

      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const result = await processProductsChangesChunk({ syncLog: log, cursor: null });

      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 0, {
          windowStart: fullScanStartedAt.getTime() - PRODUCTS_CHANGES_SAFETY_MARGIN_MS,
          windowEnd: runStartedAt.getTime(),
        }),
        progress: 0,
        total: null,
        stage: expect.any(String),
      });
      expect(router.requests).toHaveLength(0);
    });

    it('a FAILED changes run does not move the window: it anchors on the last COMPLETED changes run, even over a newer full scan', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const completedChangesStartedAt = new Date(runStartedAt.getTime() - 2 * MS_PER_HOUR);
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'COMPLETED',
        startedAt: completedChangesStartedAt,
      });
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'FAILED',
        startedAt: new Date(runStartedAt.getTime() - MS_PER_HOUR),
      });
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: new Date(runStartedAt.getTime() - 30 * MS_PER_MINUTE),
      });
      const router = routeApprovedPages({});

      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const result = await processProductsChangesChunk({ syncLog: log, cursor: null });

      expect(result.kind).toBe('continue');
      if (result.kind !== 'continue') return;
      expect(result.cursor).toEqual(
        cursorFor('VARIANT_MODIFIED_DATE', 0, {
          windowStart: completedChangesStartedAt.getTime() - PRODUCTS_CHANGES_SAFETY_MARGIN_MS,
          windowEnd: runStartedAt.getTime(),
        }),
      );
      expect(router.requests).toHaveLength(0);
    });

    it('caps the window at the 48 h look-back after a long outage', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'COMPLETED',
        startedAt: new Date(runStartedAt.getTime() - 72 * MS_PER_HOUR),
      });
      routeApprovedPages({});

      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const result = await processProductsChangesChunk({ syncLog: log, cursor: null });

      expect(result.kind).toBe('continue');
      if (result.kind !== 'continue') return;
      expect(result.cursor).toEqual(
        cursorFor('VARIANT_MODIFIED_DATE', 0, {
          windowStart: runStartedAt.getTime() - PRODUCTS_CHANGES_MAX_LOOKBACK_MS,
          windowEnd: runStartedAt.getTime(),
        }),
      );
    });

    it('no COMPLETED run to anchor on (only FAILED ones): finishes empty without a vendor call', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'FAILED',
        startedAt: new Date(runStartedAt.getTime() - 3 * MS_PER_HOUR),
      });
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'FAILED',
        startedAt: new Date(runStartedAt.getTime() - MS_PER_HOUR),
      });
      const router = routeApprovedPages({});
      const infoSpy = vi.spyOn(syncLog, 'info');

      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const result = await processProductsChangesChunk({ syncLog: log, cursor: null });

      expect(result).toEqual({ kind: 'done', finalCount: 0 });
      expect(router.requests).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith(
        'products-changes.no-window',
        expect.objectContaining({
          syncLogId: log.id,
          storeId,
          lastChangesRunStartedAt: null,
          lastFullScanStartedAt: null,
        }),
      );
    });

    it('an anchor one safety margin after this run started leaves no window: finishes empty', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'COMPLETED',
        startedAt: new Date(runStartedAt.getTime() + PRODUCTS_CHANGES_SAFETY_MARGIN_MS),
      });
      const router = routeApprovedPages({});
      const infoSpy = vi.spyOn(syncLog, 'info');

      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const result = await processProductsChangesChunk({ syncLog: log, cursor: null });

      expect(result).toEqual({ kind: 'done', finalCount: 0 });
      expect(router.requests).toHaveLength(0);
      expect(infoSpy).toHaveBeenCalledWith(
        'products-changes.no-window',
        expect.objectContaining({ syncLogId: log.id, storeId }),
      );
    });
  });

  describe('phase walk', () => {
    it('walks the three phases in order, one page per chunk with paging inside a phase, through the claim loop to COMPLETED', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const fullScanStartedAt = new Date(runStartedAt.getTime() - 3 * MS_PER_HOUR);
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: fullScanStartedAt,
      });
      await prisma.syncLog.create({
        data: {
          organizationId: orgId,
          storeId,
          syncType: 'PRODUCTS_CHANGES',
          status: 'PENDING',
          startedAt: runStartedAt,
        },
      });

      // VARIANT_MODIFIED_DATE spans two pages; CONTENT_MODIFIED_DATE returns a
      // product the first phase already wrote (counted twice, accepted);
      // VARIANT_CREATED_DATE returns a late-approved new product.
      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: approvedPage(contentsOf([101, 102]), {
          totalElements: 3,
          totalPages: 2,
          page: 0,
          nextPageToken: 'token-never-followed',
        }),
        [pageKey('VARIANT_MODIFIED_DATE', 1)]: approvedPage(contentsOf([103]), {
          totalElements: 3,
          totalPages: 2,
          page: 1,
          nextPageToken: 'token-never-followed',
        }),
        [pageKey('CONTENT_MODIFIED_DATE', 0)]: approvedPage(contentsOf([101]), {
          totalElements: 1,
          totalPages: 1,
          page: 0,
        }),
        [pageKey('VARIANT_CREATED_DATE', 0)]: approvedPage(contentsOf([104]), {
          totalElements: 1,
          totalPages: 1,
          page: 0,
        }),
      });

      const claimed = await tryClaimNext(WORKER_ID);
      if (claimed === null) throw new Error('claim failed');
      expect(claimed.syncType).toBe('PRODUCTS_CHANGES');
      await runSyncToCompletion(
        claimed,
        { PRODUCTS_CHANGES: productsChangesHandler },
        () => false,
        WORKER_ID,
      );

      expect(router.unexpected).toEqual([]);

      const windowStart = fullScanStartedAt.getTime() - PRODUCTS_CHANGES_SAFETY_MARGIN_MS;
      const windowEnd = runStartedAt.getTime();
      const queryEnd = windowEnd + PRODUCTS_CHANGES_END_ALLOWANCE_MS;
      const createdStart = windowEnd - PRODUCTS_CHANGES_CREATED_LOOKBACK_MS;
      expect(router.requests.map(queryParamsOf)).toEqual([
        { key: pageKey('VARIANT_MODIFIED_DATE', 0), startDate: windowStart, endDate: queryEnd },
        { key: pageKey('VARIANT_MODIFIED_DATE', 1), startDate: windowStart, endDate: queryEnd },
        { key: pageKey('CONTENT_MODIFIED_DATE', 0), startDate: windowStart, endDate: queryEnd },
        { key: pageKey('VARIANT_CREATED_DATE', 0), startDate: createdStart, endDate: queryEnd },
      ]);
      for (const url of router.requests) {
        expect(url.searchParams.get('size')).toBe(PAGE_SIZE.toString());
        for (const param of FORBIDDEN_QUERY_PARAMS) {
          expect(url.searchParams.has(param), `${param} on ${url.search}`).toBe(false);
        }
      }

      const final = await prisma.syncLog.findUniqueOrThrow({ where: { id: claimed.id } });
      expect(final.status).toBe('COMPLETED');
      // Five written products across the phases (101 twice).
      expect(final.recordsProcessed).toBe(5);
      expect(final.progressTotal).toBeNull();

      const products = await prisma.product.findMany({
        where: { storeId },
        orderBy: { platformContentId: 'asc' },
      });
      expect(products.map((p) => Number(p.platformContentId))).toEqual([101, 102, 103, 104]);
    });

    it('an empty, null-content or 404 page ends its phase, and the run completes after the last phase', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: emptyPage(0),
        [pageKey('CONTENT_MODIFIED_DATE', 0)]: approvedPage(null, {
          totalElements: 0,
          totalPages: 0,
          page: 0,
        }),
        [pageKey('VARIANT_CREATED_DATE', 0)]: NOT_FOUND,
      });
      const warnSpy = vi.spyOn(syncLog, 'warn');
      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });

      const first = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 0, window),
      });
      expect(first).toEqual({
        kind: 'continue',
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 0, window),
        progress: 0,
        total: null,
        stage: expect.any(String),
      });

      const second = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 0, window),
      });
      expect(second).toEqual({
        kind: 'continue',
        cursor: cursorFor('VARIANT_CREATED_DATE', 0, window),
        progress: 0,
        total: null,
        stage: expect.any(String),
      });

      const third = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_CREATED_DATE', 0, window),
      });
      expect(third).toEqual({ kind: 'done', finalCount: 0 });

      expect(router.unexpected).toEqual([]);
      expect(router.requests).toHaveLength(3);
      expect(await prisma.product.count({ where: { storeId } })).toBe(0);
      // Only the 404 leaves a trace; the 200 empty and null pages do not.
      const notFoundWarns = warnSpy.mock.calls.filter(
        ([event]) => event === 'products-changes.page-not-found',
      );
      expect(notFoundWarns).toEqual([
        [
          'products-changes.page-not-found',
          expect.objectContaining({
            syncLogId: log.id,
            storeId,
            phase: 'VARIANT_CREATED_DATE',
            page: 0,
          }),
        ],
      ]);
    });

    it('one page past the last (200 with empty content) ends the phase', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 2)]: approvedPage([], {
          totalElements: 150,
          totalPages: 2,
          page: 2,
        }),
      });
      const log = await createChangesLog({
        orgId,
        storeId,
        startedAt: runStartedAt,
        progressCurrent: 150,
      });

      const result = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 2, window),
      });

      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 0, window),
        progress: 150,
        total: null,
        stage: expect.any(String),
      });
    });

    it('an empty page ends the phase even while Trendyol still reports more pages (result set shrank mid-walk)', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const router = routeApprovedPages({
        [pageKey('CONTENT_MODIFIED_DATE', 1)]: approvedPage([], {
          totalElements: 450,
          totalPages: 5,
          page: 1,
          nextPageToken: 'token-never-followed',
        }),
      });
      const log = await createChangesLog({
        orgId,
        storeId,
        startedAt: runStartedAt,
        progressCurrent: 100,
      });

      const result = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 1, window),
      });

      expect(router.unexpected).toEqual([]);
      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('VARIANT_CREATED_DATE', 0, window),
        progress: 100,
        total: null,
        stage: expect.any(String),
      });
    });

    it('resumes from a stored cursor without recomputing the window', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      // A newer COMPLETED anchor that a recompute would pick up instead.
      await seedFinishedRun({
        orgId,
        storeId,
        syncType: 'PRODUCTS_CHANGES',
        status: 'COMPLETED',
        startedAt: new Date(runStartedAt.getTime() - 20 * MS_PER_MINUTE),
      });
      const storedWindow = {
        windowStart: runStartedAt.getTime() - 5 * MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const router = routeApprovedPages({
        [pageKey('CONTENT_MODIFIED_DATE', 3)]: approvedPage(contentsOf([301]), {
          totalElements: 450,
          totalPages: 5,
          page: 3,
          nextPageToken: 'token-never-followed',
        }),
      });
      const log = await createChangesLog({
        orgId,
        storeId,
        startedAt: runStartedAt,
        progressCurrent: 300,
      });

      const result = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 3, storedWindow),
      });

      expect(router.unexpected).toEqual([]);
      expect(router.requests.map(queryParamsOf)).toEqual([
        {
          key: pageKey('CONTENT_MODIFIED_DATE', 3),
          startDate: storedWindow.windowStart,
          endDate: storedWindow.windowEnd + PRODUCTS_CHANGES_END_ALLOWANCE_MS,
        },
      ]);
      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 4, storedWindow),
        progress: 301,
        total: null,
        stage: expect.any(String),
      });
    });
  });

  describe('10,000-item page cap', () => {
    it.each<ProductsChangesPhase>([
      'VARIANT_MODIFIED_DATE',
      'CONTENT_MODIFIED_DATE',
      'VARIANT_CREATED_DATE',
    ])(
      'a %s window over the cap on page 0 writes nothing and finishes the whole run',
      async (phase) => {
        const { orgId, storeId } = await setupTenant();
        const runStartedAt = runStartedAtNow();
        const window = {
          windowStart: runStartedAt.getTime() - MS_PER_HOUR,
          windowEnd: runStartedAt.getTime(),
        };
        const overCap = APPROVED_PAGE_CAP_ITEMS + 1;
        const router = routeApprovedPages({
          [pageKey(phase, 0)]: approvedPage(contentsOf([901]), {
            totalElements: overCap,
            totalPages: Math.ceil(overCap / PAGE_SIZE),
            page: 0,
            nextPageToken: 'token-never-followed',
          }),
        });
        const warnSpy = vi.spyOn(syncLog, 'warn');
        const progressBefore = 7;
        const log = await createChangesLog({
          orgId,
          storeId,
          startedAt: runStartedAt,
          progressCurrent: progressBefore,
        });

        const result = await processProductsChangesChunk({
          syncLog: log,
          cursor: cursorFor(phase, 0, window),
        });

        expect(result).toEqual({ kind: 'done', finalCount: progressBefore });
        expect(router.unexpected).toEqual([]);
        expect(router.requests).toHaveLength(1);
        expect(await prisma.product.count({ where: { storeId } })).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
          'products-changes.window-over-cap',
          expect.objectContaining({
            syncLogId: log.id,
            storeId,
            phase,
            page: 0,
            totalElements: overCap,
          }),
        );
      },
    );

    it('a window of exactly 10,000 items is walked, not skipped: page 0 is written and the walk moves to page 1', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: approvedPage(contentsOf([961]), {
          totalElements: APPROVED_PAGE_CAP_ITEMS,
          totalPages: APPROVED_PAGE_CAP_ITEMS / PAGE_SIZE,
          page: 0,
          nextPageToken: 'token-never-followed',
        }),
      });
      const warnSpy = vi.spyOn(syncLog, 'warn');
      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });

      const result = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 0, window),
      });

      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 1, window),
        progress: 1,
        total: null,
        stage: expect.any(String),
      });
      expect(router.unexpected).toEqual([]);
      expect(await prisma.product.count({ where: { storeId } })).toBe(1);
      expect(warnSpy).not.toHaveBeenCalledWith(
        'products-changes.window-over-cap',
        expect.anything(),
      );
    });

    it('a result set that grows past the cap mid-walk: the last page under the cap is written, the next one is never requested', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const grownTotal = APPROVED_PAGE_CAP_ITEMS + 50;
      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', LAST_PAGE_UNDER_CAP)]: approvedPage(contentsOf([951]), {
          totalElements: grownTotal,
          totalPages: Math.ceil(grownTotal / PAGE_SIZE),
          page: LAST_PAGE_UNDER_CAP,
          nextPageToken: 'token-never-followed',
        }),
      });
      const warnSpy = vi.spyOn(syncLog, 'warn');
      const log = await createChangesLog({
        orgId,
        storeId,
        startedAt: runStartedAt,
        progressCurrent: 9_900,
      });

      const lastUnderCap = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_MODIFIED_DATE', LAST_PAGE_UNDER_CAP, window),
      });
      expect(lastUnderCap).toEqual({
        kind: 'continue',
        cursor: cursorFor('VARIANT_MODIFIED_DATE', LAST_PAGE_UNDER_CAP + 1, window),
        progress: 9_901,
        total: null,
        stage: expect.any(String),
      });
      expect(await prisma.product.count({ where: { storeId } })).toBe(1);

      const pastCap = await processProductsChangesChunk({
        syncLog: { ...log, progressCurrent: 9_901 },
        cursor: cursorFor('VARIANT_MODIFIED_DATE', LAST_PAGE_UNDER_CAP + 1, window),
      });
      expect(pastCap).toEqual({ kind: 'done', finalCount: 9_901 });
      expect(router.unexpected).toEqual([]);
      expect(router.requests).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'products-changes.window-over-cap',
        expect.objectContaining({
          syncLogId: log.id,
          storeId,
          page: LAST_PAGE_UNDER_CAP + 1,
          totalElements: null,
        }),
      );
    });
  });

  describe('writes', () => {
    it('refreshes status, desi, title and images of returned products, stamps lastSyncedAt only on returned variants, and never delists', async () => {
      const { orgId, storeId } = await setupTenant();
      const runStartedAt = runStartedAtNow();
      const window = {
        windowStart: runStartedAt.getTime() - MS_PER_HOUR,
        windowEnd: runStartedAt.getTime(),
      };
      const delistedEarlier = new Date(runStartedAt.getTime() - 24 * MS_PER_HOUR);

      // Product 5001: 50011 changes, 50012 was delisted and is back, 50013 is
      // absent from the response. Product 5002 is not in the window at all.
      const changedProductId = await seedProduct({
        orgId,
        storeId,
        contentId: 5001,
        title: 'Old Title',
        variants: [
          { variantId: 50011, quantity: 10, salePrice: '100.00' },
          { variantId: 50012, quantity: 2, salePrice: '150.00', delistedAt: delistedEarlier },
          { variantId: 50013, quantity: 3, salePrice: '90.00' },
        ],
      });
      await seedProduct({
        orgId,
        storeId,
        contentId: 5002,
        title: 'Untouched Product',
        variants: [{ variantId: 50021, quantity: 4, salePrice: '40.00' }],
      });

      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: approvedPage(
          [
            buildContent({
              contentId: 5001,
              title: 'New Title',
              imageUrls: ['https://cdn.example.com/b.jpg', 'https://cdn.example.com/a.jpg'],
              variants: [
                {
                  variantId: 50011,
                  quantity: 4,
                  salePrice: 80,
                  dimensionalWeight: 2.5,
                  onSale: false,
                  locked: true,
                  lockReason: LOCK_REASON,
                },
                { variantId: 50012, quantity: 6, salePrice: 120 },
              ],
            }),
          ],
          { totalElements: 1, totalPages: 1, page: 0 },
        ),
      });
      const log = await createChangesLog({ orgId, storeId, startedAt: runStartedAt });
      const writeStartedAt = new Date();

      const result = await processProductsChangesChunk({
        syncLog: log,
        cursor: cursorFor('VARIANT_MODIFIED_DATE', 0, window),
      });

      expect(router.unexpected).toEqual([]);
      expect(result).toEqual({
        kind: 'continue',
        cursor: cursorFor('CONTENT_MODIFIED_DATE', 0, window),
        progress: 1,
        total: null,
        stage: expect.any(String),
      });

      const changedProduct = await productOf(storeId, 5001);
      expect(changedProduct.id).toBe(changedProductId);
      expect(changedProduct.title).toBe('New Title');
      expect(changedProduct.imageUrls).toEqual([
        'https://cdn.example.com/b.jpg',
        'https://cdn.example.com/a.jpg',
      ]);
      expect(changedProduct.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(
        writeStartedAt.getTime(),
      );

      const locked = await variantOf(storeId, 50011);
      expect(locked.status).toBe(ProductVariantStatus.LOCKED);
      expect(locked.statusReason).toBe(LOCK_REASON);
      expect(locked.syncedDimensionalWeight?.toString()).toBe('2.5');
      expect(locked.dimensionalWeightOverride).toBeNull();
      expect(locked.quantity).toBe(4);
      expect(locked.delistedAt).toBeNull();
      expect(locked.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(writeStartedAt.getTime());

      // A returned variant is listed by definition: the upsert clears delistedAt.
      const relisted = await variantOf(storeId, 50012);
      expect(relisted.delistedAt).toBeNull();
      expect(relisted.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(writeStartedAt.getTime());

      // Absent from the response: never delisted, never stamped, unchanged.
      const absentSibling = await variantOf(storeId, 50013);
      expect(absentSibling.delistedAt).toBeNull();
      expect(absentSibling.lastSyncedAt.getTime()).toBe(STALE_LAST_SYNCED_AT.getTime());
      expect(absentSibling.status).toBe(ProductVariantStatus.ON_SALE);
      expect(absentSibling.quantity).toBe(3);

      const outsideWindow = await variantOf(storeId, 50021);
      expect(outsideWindow.delistedAt).toBeNull();
      expect(outsideWindow.lastSyncedAt.getTime()).toBe(STALE_LAST_SYNCED_AT.getTime());
      const untouchedProduct = await productOf(storeId, 5002);
      expect(untouchedProduct.title).toBe('Untouched Product');
      expect(untouchedProduct.lastSyncedAt.getTime()).toBe(STALE_LAST_SYNCED_AT.getTime());

      // Aggregates refreshed in the upsert: every listed, non-archived variant
      // counts (LOCKED included, the absent sibling included).
      expect(changedProduct.totalStock).toBe(4 + 6 + 3);
      expect(changedProduct.minSalePrice?.toString()).toBe('80');
      expect(changedProduct.maxSalePrice?.toString()).toBe('120');

      expect(
        await prisma.productVariant.count({ where: { storeId, delistedAt: { not: null } } }),
      ).toBe(0);
    });
  });

  describe('tenant scope', () => {
    it('anchors and writes only for the job store: a sibling store and another org with the same Trendyol ids stay untouched', async () => {
      const tenantA = await setupTenant();
      const siblingStoreId = await createTestStore(tenantA.orgId, {
        externalAccountId: OTHER_SUPPLIER_ID,
        name: 'Sibling Store',
      });
      // Another organization connected to the same Trendyol seller.
      const tenantB = await setupTenant();
      const runStartedAt = runStartedAtNow();

      const fullScanStartedAt = new Date(runStartedAt.getTime() - 3 * MS_PER_HOUR);
      await seedFinishedRun({
        orgId: tenantA.orgId,
        storeId: tenantA.storeId,
        syncType: 'PRODUCTS',
        status: 'COMPLETED',
        startedAt: fullScanStartedAt,
      });
      // Fresher anchors on the other stores must not reach store A's window.
      for (const other of [
        { orgId: tenantA.orgId, storeId: siblingStoreId },
        { orgId: tenantB.orgId, storeId: tenantB.storeId },
      ]) {
        await seedFinishedRun({
          ...other,
          syncType: 'PRODUCTS_CHANGES',
          status: 'COMPLETED',
          startedAt: new Date(runStartedAt.getTime() - 10 * MS_PER_MINUTE),
        });
      }

      const seededStores = [
        { orgId: tenantA.orgId, storeId: tenantA.storeId },
        { orgId: tenantA.orgId, storeId: siblingStoreId },
        { orgId: tenantB.orgId, storeId: tenantB.storeId },
      ];
      for (const target of seededStores) {
        await seedProduct({
          ...target,
          contentId: 6001,
          title: 'Original Title',
          variants: [{ variantId: 60011, quantity: 10, salePrice: '100.00' }],
        });
      }

      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: approvedPage(
          [
            buildContent({
              contentId: 6001,
              title: 'Changed Title',
              variants: [{ variantId: 60011, quantity: 1, locked: true, lockReason: LOCK_REASON }],
            }),
          ],
          { totalElements: 1, totalPages: 1, page: 0 },
        ),
      });

      const log = await createChangesLog({
        orgId: tenantA.orgId,
        storeId: tenantA.storeId,
        startedAt: runStartedAt,
      });
      const start = await processProductsChangesChunk({ syncLog: log, cursor: null });
      expect(start.kind).toBe('continue');
      if (start.kind !== 'continue') return;
      expect(start.cursor).toEqual(
        cursorFor('VARIANT_MODIFIED_DATE', 0, {
          windowStart: fullScanStartedAt.getTime() - PRODUCTS_CHANGES_SAFETY_MARGIN_MS,
          windowEnd: runStartedAt.getTime(),
        }),
      );

      await processProductsChangesChunk({ syncLog: log, cursor: start.cursor });
      expect(router.unexpected).toEqual([]);

      const changed = await variantOf(tenantA.storeId, 60011);
      expect(changed.status).toBe(ProductVariantStatus.LOCKED);
      expect(changed.quantity).toBe(1);
      expect((await productOf(tenantA.storeId, 6001)).title).toBe('Changed Title');

      for (const untouchedStoreId of [siblingStoreId, tenantB.storeId]) {
        const variant = await variantOf(untouchedStoreId, 60011);
        expect(variant.status).toBe(ProductVariantStatus.ON_SALE);
        expect(variant.quantity).toBe(10);
        expect(variant.lastSyncedAt.getTime()).toBe(STALE_LAST_SYNCED_AT.getTime());
        expect((await productOf(untouchedStoreId, 6001)).title).toBe('Original Title');
        expect(await prisma.product.count({ where: { storeId: untouchedStoreId } })).toBe(1);
      }
    });

    it('refuses a job whose organization does not own the store, before any vendor call', async () => {
      const tenantA = await setupTenant();
      const tenantB = await setupTenant({ externalAccountId: OTHER_SUPPLIER_ID });
      const runStartedAt = runStartedAtNow();
      const router = routeApprovedPages({
        [pageKey('VARIANT_MODIFIED_DATE', 0)]: approvedPage(contentsOf([701]), {
          totalElements: 1,
          totalPages: 1,
          page: 0,
        }),
      });
      // Org B's job pointing at org A's store.
      const log = await createChangesLog({
        orgId: tenantB.orgId,
        storeId: tenantA.storeId,
        startedAt: runStartedAt,
      });

      await expect(
        processProductsChangesChunk({
          syncLog: log,
          cursor: cursorFor('VARIANT_MODIFIED_DATE', 0, {
            windowStart: runStartedAt.getTime() - MS_PER_HOUR,
            windowEnd: runStartedAt.getTime(),
          }),
        }),
      ).rejects.toThrow();
      expect(router.requests).toHaveLength(0);
      expect(await prisma.product.count()).toBe(0);
    });
  });
});
