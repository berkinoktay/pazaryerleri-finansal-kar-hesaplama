// Variant-resolution tick (spec 2026-06-11 §4 D3-D5).
//
// Order: (1) local first-match, which links variants the daily full sync already
// brought with zero API calls; (2) a targeted vendor query for the remaining DISTINCT
// barcodes per store, through the existing products upsert pipeline (a barcode the
// vendor already confirmed missing is not queried: it waits for its
// CatalogBarcodeMiss deadline); (3) match and link again; (4) attempts++ and a
// backoff for the rest. Matching mirrors intake exactly: (organizationId, storeId,
// barcode) first-match (findFirstVariantByBarcode).
// Tick crash-safe: çağıran (index.ts) catch'ler; burada mağaza-başına izolasyon.

import { ensureBarcodesInCatalog } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { enqueueProfitRecompute, findFirstVariantByBarcode } from '@pazarsync/profit';
import { syncLog } from '@pazarsync/sync-core';

const MAX_BARCODES_PER_STORE_PER_TICK = 25;
const DUE_ITEMS_PER_TICK = 500;
const BACKOFF_BASE_MS = 5 * 60_000; // 5 dk
const BACKOFF_CAP_MS = 24 * 60 * 60_000; // 24 saat
const VENDOR_MISSING_BACKOFF_MS = 24 * 60 * 60_000; // confirmed-absent barcodes: flat ~24h, NOT exponential, never terminal (a later-approved product is picked up next day)

interface DueItem {
  id: string;
  barcode: string | null;
  variantResolutionAttempts: number;
  order: { id: string; storeId: string; organizationId: string };
}

/**
 * The tenant pair every read and write of one resolution group is pinned to. Work is
 * grouped by the pair, never by the store alone, so a row carrying another
 * organization's store id never reaches that organization's store, catalog or miss
 * rows: the store load filters both ids and fails closed on a mismatch.
 */
interface ResolutionScope {
  organizationId: string;
  storeId: string;
}

/** Map key of a (organizationId, storeId) pair; both are UUIDs, so ':' never collides. */
function scopeKey(scope: ResolutionScope): string {
  return `${scope.organizationId}:${scope.storeId}`;
}

function nextBackoff(attempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  return new Date(Date.now() + delay);
}

/** Flat 24h deadline for confirmed vendor-absent barcodes (never exponential). */
function nextVendorMissingRetry(): Date {
  return new Date(Date.now() + VENDOR_MISSING_BACKOFF_MS);
}

// Aynı-proses çakışma guard'ı: boot koşumu + 60s interval (veya vendor
// yavaşlamasıyla 60s'i aşan bir tick) üst üste binerse ikincisi no-op olur.
// Çoklu worker instance'ı için satır-claim YOK (buffer-promote'un SKIP
// LOCKED'ının aksine) — bilinçli: tick'in tüm yazıları idempotent/write-once,
// çakışmanın maliyeti yalnız mükerrer vendor sorgusu. Çok-instance deployment
// gündeme gelirse SKIP LOCKED claim'e geçir.
let tickInFlight = false;

export async function processVariantResolution(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await runResolutionTick();
  } finally {
    tickInFlight = false;
  }
}

async function runResolutionTick(): Promise<void> {
  await resolveDueOrderItems();
  // 2. kaynak buradan KOŞULSUZ koşar — due item olmaması buffer onarımını
  // atlatamaz (buffer entry'nin order item'ı yoktur; spec 2026-06-12 §4/K6).
  await repairBufferCatalogGaps();
}

async function resolveDueOrderItems(): Promise<void> {
  // Due, unresolved items, grouped per (organizationId, storeId) pair.
  // Sıralama deterministik (vade önce, null=hiç denenmemiş en önde): take-500
  // penceresi tick'ler arasında kararlı dolaşır, tek mağazanın taşması
  // diğerlerini rastgele aç bırakamaz.
  const due: DueItem[] = await prisma.orderItem.findMany({
    where: {
      productVariantId: null,
      barcode: { not: null },
      OR: [{ nextResolutionAt: null }, { nextResolutionAt: { lte: new Date() } }],
    },
    select: {
      id: true,
      barcode: true,
      variantResolutionAttempts: true,
      order: { select: { id: true, storeId: true, organizationId: true } },
    },
    orderBy: [{ nextResolutionAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: DUE_ITEMS_PER_TICK,
  });
  if (due.length === 0) return;

  const byScope = new Map<string, { scope: ResolutionScope; items: DueItem[] }>();
  for (const item of due) {
    const scope = { organizationId: item.order.organizationId, storeId: item.order.storeId };
    const group = byScope.get(scopeKey(scope)) ?? { scope, items: [] };
    group.items.push(item);
    byScope.set(scopeKey(scope), group);
  }

  for (const { scope, items } of byScope.values()) {
    const { organizationId, storeId } = scope;
    try {
      await resolveForStore(scope, items);
    } catch (err) {
      // Mağaza-başına izolasyon: bir mağazanın hatası (ör. vendor 5xx, bozuk
      // credential) diğerlerini durdurmaz. Kalıcı hata 60s hot-loop'a ve
      // pencere işgaline dönüşmesin diye mağazanın satırlarına da backoff
      // yazılır (best-effort) — transient hata 5 dk gecikme öder, kalıcı
      // hata üstel olarak pencereden çekilir.
      syncLog.error('resolution.store-failed', {
        organizationId,
        storeId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Mağaza-hatası geçicidir (5xx/credential): üstel eğriyle pencereden çek.
      await applyBackoff(scope, items, 'retriable').catch((backoffErr: unknown) => {
        syncLog.error('resolution.store-backoff-failed', {
          storeId,
          errorMessage: backoffErr instanceof Error ? backoffErr.message : String(backoffErr),
        });
      });
    }
  }
}

// Buffer-gap onarımının vendor nezaketi: buffer satırında attempts/backoff
// kolonu YOK (satır gece yarısı flush'la ölür), bu yüzden vade CatalogBarcodeMiss
// TABLOSUNDA tutulur (süreç yeniden başlasa da kalıcı). İki eğri ayrışır:
// `vendorMissing` (vendor'da gerçekten yok) DÜZ ~24 saat (asla üstel, asla
// terminal — sonradan onaylanan ürün ertesi gün yakalanır); `retriable`
// (sorgu attı / cap-dışı / credential bozuk) MEVCUT üstel eğri. Tablo aynı
// zamanda "Trendyol'da yok" UI rozetini besler.

/**
 * Writes the scope's CatalogBarcodeMiss row for `barcode` (attempts++ on an existing
 * row, attempts 1 on a new one) and returns the nextRetryAt it computed. `attempts`
 * is the row's CURRENT attempt count (0 for a new row); the exponential `retriable`
 * deadline is derived from it, the flat `vendorMissing` deadline is not.
 *
 * Organization-safe: the table is unique on (storeId, barcode), so a row of this
 * store stamped with another organization (the database allows it) holds the key.
 * That row is never modified: the update is guarded by organizationId and the insert
 * skips the conflict instead of throwing into the per-store catch. The computed
 * deadline is still returned, so the caller's items back off on it.
 */
async function upsertBarcodeMiss(
  scope: ResolutionScope,
  barcode: string,
  vendorMissing: boolean,
  attempts: number,
): Promise<Date> {
  const { organizationId, storeId } = scope;
  const nextRetryAt = vendorMissing ? nextVendorMissingRetry() : nextBackoff(attempts);
  const updated = await prisma.catalogBarcodeMiss.updateMany({
    where: { organizationId, storeId, barcode },
    data: {
      vendorMissing,
      attempts: { increment: 1 },
      lastCheckedAt: new Date(),
      nextRetryAt,
    },
  });
  if (updated.count > 0) return nextRetryAt;

  const created = await prisma.catalogBarcodeMiss.createMany({
    data: [{ organizationId, storeId, barcode, vendorMissing, attempts: 1, nextRetryAt }],
    skipDuplicates: true,
  });
  if (created.count === 0) {
    // The (storeId, barcode) key is held by a row this organization cannot update:
    // another organization's row in this store, or a concurrent insert.
    syncLog.warn('resolution.miss-row-skipped', { organizationId, storeId, barcode });
  }
  return nextRetryAt;
}

/**
 * 2. kaynak: PENDING buffer satırlarının çözülmemiş barkodları (spec
 * 2026-06-12 §4/K6). Eager intake onarımı vendor hatasıyla kaçtıysa gün
 * İÇİNDE kataloğu onarır — satıcı pencere kapanmadan maliyet ekleyebilsin.
 * Item bağlama gerekmez: mezuniyet/promote yazımı variant'ı kendisi bulur.
 */
async function repairBufferCatalogGaps(): Promise<void> {
  // A gap is judged within the buffer row's own organization and store, the same
  // scope the order-line resolvers (findFirstVariantByBarcode) link in: a variant row
  // of the store stamped with another organization does not close it.
  const bufferGaps = await prisma.$queryRaw<
    Array<{ organization_id: string; store_id: string; barcode: string }>
  >`
    SELECT DISTINCT b.organization_id, b.store_id, line->>'barcode' AS barcode
    FROM live_performance_buffer b,
         jsonb_array_elements(b.mapped_order->'lines') AS line
    WHERE b.status = 'PENDING'
      AND line->>'barcode' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_variants pv
        WHERE pv.organization_id = b.organization_id
          AND pv.store_id = b.store_id
          AND pv.barcode = line->>'barcode'
      )
    LIMIT 200
  `;
  if (bufferGaps.length === 0) return;

  const gapsByScope = new Map<string, { scope: ResolutionScope; barcodes: string[] }>();
  for (const row of bufferGaps) {
    const scope = { organizationId: row.organization_id, storeId: row.store_id };
    const group = gapsByScope.get(scopeKey(scope)) ?? { scope, barcodes: [] };
    group.barcodes.push(row.barcode);
    gapsByScope.set(scopeKey(scope), group);
  }

  const now = new Date();
  for (const { scope, barcodes: allBarcodes } of gapsByScope.values()) {
    const { organizationId, storeId } = scope;
    try {
      // A mismatched pair (a buffer row carrying another organization's store id)
      // throws into the catch below: the vendor is never queried with that store.
      const store = await prisma.store.findFirstOrThrow({ where: { id: storeId, organizationId } });
      // Vade kontrolü tablodan: satırı OLMAYAN barkod (hiç denenmemiş) ya da
      // nextRetryAt NULL/geçmiş olan vadesi gelmiştir; geleceğe bakan
      // nextRetryAt'li barkod bu tick'te atlanır (vendor sorgusu YOK).
      const existing = await prisma.catalogBarcodeMiss.findMany({
        where: { organizationId, storeId, barcode: { in: allBarcodes } },
        select: { barcode: true, attempts: true, nextRetryAt: true },
      });
      const missByBarcode = new Map(existing.map((m) => [m.barcode, m]));
      const dueBarcodes = allBarcodes.filter((barcode) => {
        const miss = missByBarcode.get(barcode);
        return miss === undefined || miss.nextRetryAt === null || miss.nextRetryAt <= now;
      });
      if (dueBarcodes.length === 0) continue;

      // Dilim ÇAĞRIDAN önce: ensure'un retriable'ı cap-dışı (denenmemiş)
      // barkodları da içerir — denenmeyene backoff yazılmaz, sıradaki tick alır.
      const barcodes = dueBarcodes.slice(0, MAX_BARCODES_PER_STORE_PER_TICK);
      const result = await ensureBarcodesInCatalog(store, barcodes, {
        maxVendorCalls: MAX_BARCODES_PER_STORE_PER_TICK,
      });
      if (result.resolved.length > 0) {
        await prisma.catalogBarcodeMiss.deleteMany({
          where: { organizationId, storeId, barcode: { in: result.resolved } },
        });
      }
      for (const barcode of result.vendorMissing) {
        await upsertBarcodeMiss(scope, barcode, true, missByBarcode.get(barcode)?.attempts ?? 0);
      }
      for (const barcode of result.retriable) {
        await upsertBarcodeMiss(scope, barcode, false, missByBarcode.get(barcode)?.attempts ?? 0);
      }
    } catch (err) {
      syncLog.error('resolution.buffer-repair-failed', {
        organizationId,
        storeId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

type BackoffKind = 'retriable' | 'vendorMissing';

/**
 * The item's next deadline for `kind`: `retriable` (a transient or store failure)
 * follows the exponential curve keyed off the item's own attempts; `vendorMissing`
 * takes its barcode's CatalogBarcodeMiss deadline, so every item of the barcode
 * shares one clock (flat ~24h when the caller has no deadline for it).
 */
function nextResolutionFor(
  item: DueItem,
  kind: BackoffKind,
  deadlineByBarcode: ReadonlyMap<string, Date> | undefined,
): Date {
  switch (kind) {
    case 'retriable':
      return nextBackoff(item.variantResolutionAttempts);
    case 'vendorMissing': {
      const deadline = item.barcode === null ? undefined : deadlineByBarcode?.get(item.barcode);
      return deadline ?? nextVendorMissingRetry();
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled backoff kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * attempts++ and a new deadline per item (see nextResolutionFor). The table is not
 * written here: for `vendorMissing` the caller upserts the barcode's miss row FIRST
 * and passes its deadline in `deadlineByBarcode`.
 */
async function applyBackoff(
  scope: ResolutionScope,
  items: DueItem[],
  kind: BackoffKind,
  deadlineByBarcode?: ReadonlyMap<string, Date>,
): Promise<void> {
  const { organizationId, storeId } = scope;
  for (const item of items) {
    const nextResolutionAt = nextResolutionFor(item, kind, deadlineByBarcode);
    await prisma.orderItem.updateMany({
      // Scope through the order: order_items.organization_id is nullable in the schema.
      where: { id: item.id, order: { organizationId, storeId } },
      data: {
        variantResolutionAttempts: item.variantResolutionAttempts + 1,
        nextResolutionAt,
      },
    });
    syncLog.info('resolution.deferred', {
      organizationId,
      storeId,
      orderItemId: item.id,
      barcode: item.barcode,
      attempts: item.variantResolutionAttempts + 1,
      kind,
    });
  }
}

/**
 * Gate of the order-item path: a barcode the vendor already confirmed missing, whose
 * CatalogBarcodeMiss deadline is still ahead, is not queried again. Its items take the
 * row's nextRetryAt and keep their attempts; the row is not touched. Returns the
 * items that still go to the vendor.
 */
async function deferKnownVendorMissing(
  scope: ResolutionScope,
  items: DueItem[],
): Promise<DueItem[]> {
  const { organizationId, storeId } = scope;
  const barcodes = [...new Set(items.flatMap((i) => (i.barcode === null ? [] : [i.barcode])))];
  if (barcodes.length === 0) return items;

  const rows = await prisma.catalogBarcodeMiss.findMany({
    where: {
      organizationId,
      storeId,
      barcode: { in: barcodes },
      vendorMissing: true,
      nextRetryAt: { gt: new Date() },
    },
    select: { barcode: true, nextRetryAt: true },
  });
  const deadlineByBarcode = new Map<string, Date>();
  for (const row of rows) {
    if (row.nextRetryAt !== null) deadlineByBarcode.set(row.barcode, row.nextRetryAt);
  }
  if (deadlineByBarcode.size === 0) return items;

  for (const [barcode, nextResolutionAt] of deadlineByBarcode) {
    const gated = items.filter((i) => i.barcode === barcode);
    await prisma.orderItem.updateMany({
      where: { id: { in: gated.map((i) => i.id) }, order: { organizationId, storeId } },
      data: { nextResolutionAt },
    });
    for (const item of gated) {
      syncLog.info('resolution.deferred', {
        organizationId,
        storeId,
        orderItemId: item.id,
        barcode,
        attempts: item.variantResolutionAttempts,
        kind: 'vendorMissingKnown',
      });
    }
  }
  return items.filter((i) => i.barcode === null || !deadlineByBarcode.has(i.barcode));
}

async function resolveForStore(scope: ResolutionScope, items: DueItem[]): Promise<void> {
  const { organizationId, storeId } = scope;
  // 1) Yerel first-match (ucuz yol — vendor'a gitmeden bağla).
  let remaining = await linkAgainstLocalCatalog(storeId, items);
  if (remaining.length === 0) {
    // İlk geçişte hepsi yerelden bağlandıysa: bunların açık bir
    // CatalogBarcodeMiss rozeti varsa kapat (gap kapandı).
    await clearMissForLinked(scope, items, remaining);
    return;
  }

  // 2) Hedefli vendor sorgusu — ensureBarcodesInCatalog'a delege (spec
  // 2026-06-12 PR-2): tekil barkod fetch + tam katalog hattı + hata yutma
  // tek yerde yaşar. Dilim burada atılır ki backoff yalnız bu tick'te
  // GERÇEKTEN sorgulanan barkodlara işlesin — cap'e sığmayanlar denenmeden
  // cezalandırılmaz, vadesiz (null) kaldıkları için sıralama gereği sonraki
  // tick'in penceresinde öne geçerler.
  // A mismatched pair (an order carrying another organization's store id) throws
  // into the caller's per-store catch, which writes a backoff: the vendor is never
  // queried with another organization's store or credentials.
  const store = await prisma.store.findFirstOrThrow({ where: { id: storeId, organizationId } });

  // A barcode the vendor already confirmed missing waits for its CatalogBarcodeMiss
  // deadline (one clock per barcode). Gated after the local match, so a variant that
  // reached the catalog meanwhile still links, and before the slice, so a gated
  // barcode never takes a slot. A mismatched pair already failed closed above and
  // never reads the miss table.
  remaining = await deferKnownVendorMissing(scope, remaining);
  if (remaining.length === 0) return;

  const distinctBarcodes = [
    ...new Set(remaining.flatMap((i) => (i.barcode === null ? [] : [i.barcode]))),
  ].slice(0, MAX_BARCODES_PER_STORE_PER_TICK);

  const result = await ensureBarcodesInCatalog(store, distinctBarcodes, {
    maxVendorCalls: MAX_BARCODES_PER_STORE_PER_TICK,
  });

  // 3) Tekrar eşle.
  const beforeRelink = remaining;
  remaining = await linkAgainstLocalCatalog(storeId, remaining);

  // Bağlanan satırların barkodları için açık CatalogBarcodeMiss rozetini kapat.
  await clearMissForLinked(scope, beforeRelink, remaining);

  // 4) Sorgulanıp hâlâ çözülemeyenleri eğriye göre ayır:
  //    - vendorMissing → DÜZ 24 saat + tabloya rozet (UI "Trendyol'da yok").
  //    - retriable/diğer → mevcut üstel; tablo YAZILMAZ (item kendi vadesini
  //      sahiplenir, tablo geçici-retry için kullanılmaz).
  const queried = new Set(distinctBarcodes);
  const vendorMissingBarcodes = new Set(result.vendorMissing);
  // `attempted` yalnız bu tick'te GERÇEKTEN sorgulanan (cap'e sığan) satırlar —
  // barcode burada non-null GARANTİ (filtre öyle kuruyor).
  const attempted = remaining.filter(
    (i): i is DueItem & { barcode: string } => i.barcode !== null && queried.has(i.barcode),
  );
  const vendorMissingItems = attempted.filter((i) => vendorMissingBarcodes.has(i.barcode));
  const retriableItems = attempted.filter((i) => !vendorMissingBarcodes.has(i.barcode));

  // Upsert the table ONCE per distinct barcode, not once per order line: a
  // barcode that sits on N lines in this tick must not increment attempts N
  // times. An inflated count would push repairBufferCatalogGaps's first
  // transient-failure retry straight to the 24h backoff cap, so a same-day
  // buffered order could miss its catalog repair before its cost window closes.
  // The row is written first and its deadline is handed to every item of the
  // barcode (one clock per barcode); the per-item backoff below still bumps each
  // item's own attempts.
  const deadlineByBarcode = new Map<string, Date>();
  for (const barcode of new Set(vendorMissingItems.map((i) => i.barcode))) {
    deadlineByBarcode.set(barcode, await upsertBarcodeMiss(scope, barcode, true, 0));
  }
  await applyBackoff(scope, vendorMissingItems, 'vendorMissing', deadlineByBarcode);
  // retriable yolu tabloya KASITLI yazmaz → varsa önceki vendorMissing=true
  // satırı OLDUĞU GİBİ kalır (rozet "Trendyol'da yok" durur). İyi-huylu bayatlık:
  // dün gerçekten yok olan barkod bugünkü geçici hataya rağmen muhtemelen hâlâ
  // yok; bir sonraki vendorMissing teyidi ya da resolved silmesi düzeltir. Bunu
  // false'a çekmek tablo<->item iki yazar arasında çatışma doğurur — yapma.
  await applyBackoff(scope, retriableItems, 'retriable');
}

/**
 * Bu tick'te bağlanan satırların barkodları için açık CatalogBarcodeMiss
 * rozetini siler (gap kapandı). `before` bağlanmadan önceki listedir, `after`
 * hâlâ çözülemeyenler — ikisinin farkı bu tick'te bağlananlardır.
 * Tenant-scoped: only the group's own (organizationId, storeId) rows are deleted.
 */
async function clearMissForLinked(
  scope: ResolutionScope,
  before: DueItem[],
  after: DueItem[],
): Promise<void> {
  const stillUnresolved = new Set(after.map((i) => i.id));
  const linkedBarcodes = [
    ...new Set(
      before.flatMap((i) => (i.barcode !== null && !stillUnresolved.has(i.id) ? [i.barcode] : [])),
    ),
  ];
  if (linkedBarcodes.length === 0) return;
  await prisma.catalogBarcodeMiss.deleteMany({
    where: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      barcode: { in: linkedBarcodes },
    },
  });
}

/** Drops the linked items from the list; links the variant identity and enqueues one recompute per order, in that order's own tx. */
async function linkAgainstLocalCatalog(storeId: string, items: DueItem[]): Promise<DueItem[]> {
  const stillUnresolved: DueItem[] = [];
  // Group by order so the identity link and the enqueue share one per-order tx.
  const byOrder = new Map<string, DueItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order.id) ?? [];
    list.push(item);
    byOrder.set(item.order.id, list);
  }

  for (const [orderId, orderItems] of byOrder) {
    await prisma.$transaction(async (tx) => {
      // The identity link always runs (visibility contract: the product name and
      // image must show), independent of any profit exclusion. The profit is no
      // longer written here; a linked item changes the parcel's profit, so the
      // order is enqueued for the recompute tick instead.
      let linkedAny = false;
      let organizationId: string | null = null;
      for (const item of orderItems) {
        organizationId = item.order.organizationId;
        if (item.barcode === null) {
          stillUnresolved.push(item);
          continue;
        }
        // Lowest variant id for a barcode shared by two variants, inside the order's
        // own organization and store: the same choice as buildCalcCheckLines, so the
        // gate and the stored order item name one variant.
        const variant = await findFirstVariantByBarcode(tx, {
          organizationId: item.order.organizationId,
          storeId,
          barcode: item.barcode,
        });
        if (variant === null) {
          stillUnresolved.push(item);
          continue;
        }
        await tx.orderItem.update({
          where: { id: item.id },
          data: { productVariantId: variant.id },
        });
        linkedAny = true;
        syncLog.info('resolution.linked', {
          storeId,
          orderItemId: item.id,
          barcode: item.barcode,
          productVariantId: variant.id,
        });
      }
      if (linkedAny && organizationId !== null) {
        await enqueueProfitRecompute(tx, {
          organizationId,
          reason: ProfitRecomputeReason.ORDER_CHANGED,
          storeId,
          orderIds: [orderId],
        });
      }
    });
  }
  return stillUnresolved;
}
