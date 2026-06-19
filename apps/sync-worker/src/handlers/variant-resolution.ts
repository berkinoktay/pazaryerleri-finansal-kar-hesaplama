// Variant-resolution tick (spec 2026-06-11 §4 D3-D5).
//
// Sıra: (1) yerel first-match — günlük tam senkronla gelmiş variant'ları sıfır
// API çağrısıyla bağlar; (2) hâlâ eşleşmeyenler için mağaza-başına TEKİL
// barkodlarla hedefli vendor sorgusu → mevcut products upsert hattı; (3) tekrar
// eşle + bağla; (4) kalanlara attempts++ ve üstel backoff. Eşleştirme semantiği
// intake ile birebir: (storeId, barcode) first-match (build-calc-check-lines).
// Tick crash-safe: çağıran (index.ts) catch'ler; burada mağaza-başına izolasyon.

import { ensureBarcodesInCatalog } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { captureCostSnapshot } from '@pazarsync/order-sync';
import { applyEstimateOnOrderCreate } from '@pazarsync/profit';
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
  // Vadesi gelmiş, çözülmemiş satırlar — mağaza başına gruplanır. Sıralama
  // deterministik (vade önce, null=hiç denenmemiş en önde): take-500
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

  const byStore = new Map<string, DueItem[]>();
  for (const item of due) {
    const list = byStore.get(item.order.storeId) ?? [];
    list.push(item);
    byStore.set(item.order.storeId, list);
  }

  for (const [storeId, items] of byStore) {
    try {
      await resolveForStore(storeId, items);
    } catch (err) {
      // Mağaza-başına izolasyon: bir mağazanın hatası (ör. vendor 5xx, bozuk
      // credential) diğerlerini durdurmaz. Kalıcı hata 60s hot-loop'a ve
      // pencere işgaline dönüşmesin diye mağazanın satırlarına da backoff
      // yazılır (best-effort) — transient hata 5 dk gecikme öder, kalıcı
      // hata üstel olarak pencereden çekilir.
      syncLog.error('resolution.store-failed', {
        storeId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Mağaza-hatası geçicidir (5xx/credential): üstel eğriyle pencereden çek.
      await applyBackoff(storeId, items, 'retriable').catch((backoffErr: unknown) => {
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
 * (storeId, barcode) için CatalogBarcodeMiss satırını idempotent upsert eder.
 * `attempts` parametresi tablodaki MEVCUT deneme sayısıdır (default 0); üstel
 * `retriable` vadesi bunun üzerinden hesaplanır, increment'le birlikte yazılır.
 */
async function upsertBarcodeMiss(
  storeId: string,
  organizationId: string,
  barcode: string,
  vendorMissing: boolean,
  attempts: number,
): Promise<void> {
  const nextRetryAt = vendorMissing ? nextVendorMissingRetry() : nextBackoff(attempts);
  await prisma.catalogBarcodeMiss.upsert({
    where: { storeId_barcode: { storeId, barcode } },
    create: {
      organizationId,
      storeId,
      barcode,
      vendorMissing,
      attempts: 1,
      nextRetryAt,
    },
    update: {
      vendorMissing,
      attempts: { increment: 1 },
      lastCheckedAt: new Date(),
      nextRetryAt,
    },
  });
}

/**
 * 2. kaynak: PENDING buffer satırlarının çözülmemiş barkodları (spec
 * 2026-06-12 §4/K6). Eager intake onarımı vendor hatasıyla kaçtıysa gün
 * İÇİNDE kataloğu onarır — satıcı pencere kapanmadan maliyet ekleyebilsin.
 * Item bağlama gerekmez: mezuniyet/promote yazımı variant'ı kendisi bulur.
 */
async function repairBufferCatalogGaps(): Promise<void> {
  const bufferGaps = await prisma.$queryRaw<Array<{ store_id: string; barcode: string }>>`
    SELECT DISTINCT b.store_id, line->>'barcode' AS barcode
    FROM live_performance_buffer b,
         jsonb_array_elements(b.mapped_order->'lines') AS line
    WHERE b.status = 'PENDING'
      AND line->>'barcode' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_variants pv
        WHERE pv.store_id = b.store_id AND pv.barcode = line->>'barcode'
      )
    LIMIT 200
  `;
  if (bufferGaps.length === 0) return;

  const gapsByStore = new Map<string, string[]>();
  for (const row of bufferGaps) {
    const list = gapsByStore.get(row.store_id) ?? [];
    list.push(row.barcode);
    gapsByStore.set(row.store_id, list);
  }

  const now = new Date();
  for (const [storeId, allBarcodes] of gapsByStore) {
    try {
      const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
      // Vade kontrolü tablodan: satırı OLMAYAN barkod (hiç denenmemiş) ya da
      // nextRetryAt NULL/geçmiş olan vadesi gelmiştir; geleceğe bakan
      // nextRetryAt'li barkod bu tick'te atlanır (vendor sorgusu YOK).
      const existing = await prisma.catalogBarcodeMiss.findMany({
        where: { storeId, barcode: { in: allBarcodes } },
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
          where: { storeId, barcode: { in: result.resolved } },
        });
      }
      for (const barcode of result.vendorMissing) {
        await upsertBarcodeMiss(
          storeId,
          store.organizationId,
          barcode,
          true,
          missByBarcode.get(barcode)?.attempts ?? 0,
        );
      }
      for (const barcode of result.retriable) {
        await upsertBarcodeMiss(
          storeId,
          store.organizationId,
          barcode,
          false,
          missByBarcode.get(barcode)?.attempts ?? 0,
        );
      }
    } catch (err) {
      syncLog.error('resolution.buffer-repair-failed', {
        storeId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

type BackoffKind = 'retriable' | 'vendorMissing';

/**
 * attempts++ + vade yazar. Eğri `kind`'a göre ayrışır: `retriable` (geçici
 * hata / mağaza-hatası) MEVCUT üstel eğri; `vendorMissing` (vendor'da gerçekten
 * yok) DÜZ ~24 saat. `nextResolutionAt` order-item'ın KENDİ geçici-retry'sini
 * sahiplenir; tablo yalnız vendorMissing UI rozeti + buffer-gap için yazılır
 * (bu yolda tabloya yazma yok — yanı sıra çağıran üstlenir).
 */
async function applyBackoff(storeId: string, items: DueItem[], kind: BackoffKind): Promise<void> {
  for (const item of items) {
    const nextResolutionAt =
      kind === 'vendorMissing'
        ? nextVendorMissingRetry()
        : nextBackoff(item.variantResolutionAttempts);
    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        variantResolutionAttempts: item.variantResolutionAttempts + 1,
        nextResolutionAt,
      },
    });
    syncLog.info('resolution.deferred', {
      storeId,
      orderItemId: item.id,
      barcode: item.barcode,
      attempts: item.variantResolutionAttempts + 1,
      kind,
    });
  }
}

async function resolveForStore(storeId: string, items: DueItem[]): Promise<void> {
  // 1) Yerel first-match (ucuz yol — vendor'a gitmeden bağla).
  let remaining = await linkAgainstLocalCatalog(storeId, items);
  if (remaining.length === 0) {
    // İlk geçişte hepsi yerelden bağlandıysa: bunların açık bir
    // CatalogBarcodeMiss rozeti varsa kapat (gap kapandı).
    await clearMissForLinked(storeId, items, remaining);
    return;
  }

  // 2) Hedefli vendor sorgusu — ensureBarcodesInCatalog'a delege (spec
  // 2026-06-12 PR-2): tekil barkod fetch + tam katalog hattı + hata yutma
  // tek yerde yaşar. Dilim burada atılır ki backoff yalnız bu tick'te
  // GERÇEKTEN sorgulanan barkodlara işlesin — cap'e sığmayanlar denenmeden
  // cezalandırılmaz, vadesiz (null) kaldıkları için sıralama gereği sonraki
  // tick'in penceresinde öne geçerler.
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
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
  await clearMissForLinked(storeId, beforeRelink, remaining);

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

  await applyBackoff(storeId, vendorMissingItems, 'vendorMissing');
  for (const item of vendorMissingItems) {
    await upsertBarcodeMiss(storeId, item.order.organizationId, item.barcode, true, 0);
  }
  await applyBackoff(storeId, retriableItems, 'retriable');
}

/**
 * Bu tick'te bağlanan satırların barkodları için açık CatalogBarcodeMiss
 * rozetini siler (gap kapandı). `before` bağlanmadan önceki listedir, `after`
 * hâlâ çözülemeyenler — ikisinin farkı bu tick'te bağlananlardır.
 */
async function clearMissForLinked(
  storeId: string,
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
    where: { storeId, barcode: { in: linkedBarcodes } },
  });
}

/** Bağlananları listeden düşürür; bağlama + snapshot + estimate tek tx/order. */
async function linkAgainstLocalCatalog(storeId: string, items: DueItem[]): Promise<DueItem[]> {
  const stillUnresolved: DueItem[] = [];
  // Order bazında grupla — snapshot + estimate order-tx'inde koşar.
  const byOrder = new Map<string, DueItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.order.id) ?? [];
    list.push(item);
    byOrder.set(item.order.id, list);
  }

  for (const [orderId, orderItems] of byOrder) {
    await prisma.$transaction(async (tx) => {
      // Kâr-dışı sipariş (spec 2026-06-12): kalem KİMLİK için yine bağlanır
      // (görünürlük sözleşmesi — ürün adı/görseli görünsün) ama para
      // re-entry'si atlanır. Alt guard'lar zaten no-op yapar — bu şart
      // niyeti koda yazar ve gereksiz sorguları keser.
      const orderRow = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { profitExcludedAt: true },
      });
      const moneyFrozen = orderRow.profitExcludedAt !== null;
      let linkedAny = false;
      for (const item of orderItems) {
        if (item.barcode === null) {
          stillUnresolved.push(item);
          continue;
        }
        const variant = await tx.productVariant.findFirst({
          where: { storeId, barcode: item.barcode },
          select: { id: true },
        });
        if (variant === null) {
          stillUnresolved.push(item);
          continue;
        }
        await tx.orderItem.update({
          where: { id: item.id },
          data: { productVariantId: variant.id },
        });
        if (!moneyFrozen) {
          await captureCostSnapshot(item.id, tx);
        }
        linkedAny = true;
        syncLog.info('resolution.linked', {
          storeId,
          orderItemId: item.id,
          barcode: item.barcode,
          productVariantId: variant.id,
        });
      }
      if (linkedAny && !moneyFrozen) {
        // Write-once + re-entry-safe: estimatedNetProfit doluysa no-op; eksik
        // snapshot kaldıysa null bırakır, sonraki bağlamada yeniden denenir.
        await applyEstimateOnOrderCreate(orderId, tx);
      }
    });
  }
  return stillUnresolved;
}
