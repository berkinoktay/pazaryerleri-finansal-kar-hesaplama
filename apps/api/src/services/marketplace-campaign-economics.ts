// Kampanyalar'ın TEK girdi çözümleyicisi: bir kampanya kaleminin fiyatlanabilmesi için gereken
// her şeyi (eşleşen varyant, görsel, maliyet, kargo ve üç kademeli komisyon zincirinin girdileri)
// tek bir toplu geçişte kurar.
//
// Neden ayrı bir modül: bu, "modal satırla çelişmemeli" değişmezinin GİRDİ tarafıdır. Detay
// görünümü ile kâr-dökümü/hedef-marj servisleri ayrı ayrı çözümleseydi — ki bir süre öyleydi —
// zincire bir kademe eklemek, bantların hangi koşulda geçerli sayıldığını değiştirmek ya da
// çapanın anlamını oynatmak yalnız BİR tarafı günceller ve diğer taraf sessizce eski zinciri
// kullanmaya devam ederdi. Hiçbir test de düşmezdi. Tek uygulama olunca böyle bir sapma
// yapısal olarak imkânsız.
//
// Her sorgu organizationId + storeId ile süzülür (kiracı izolasyonu). Hesap YOK: burada yalnız
// veri toplanır, matematiğin tamamı `marketplace-campaign-compute.service.ts`'te yaşar.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { resolveCommissionRate } from './commission-rate-resolver';
import { resolveDiscountCommissionSource } from './discount-commission-source';
import type { DiscountCommissionInputs } from './discount-math-commons';
import type { TariffAssemblyContext, TariffVariant } from './marketplace-campaign-compute.service';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import { NO_SHIPPING } from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';

/** Bir kalemin çözülmüş fiyatlama girdileri. */
export interface CampaignItemEconomics {
  /** Barkodla eşleşen katalog varyantı; eşleşme yoksa null (kâr "ürün yok" ile boş kalır). */
  readonly variant: TariffVariant | null;
  /** Ürünün ilk görseli — her ürün yüzeyinde görsel gösterilir (proje kuralı). */
  readonly imageUrl: string | null;
  readonly cost: VariantCostAggregate | undefined;
  readonly shipping: EstimateOutcome;
  /** Üç kademeli zincirin girdileri: tarife bandı → ürünün senkron oranı → kategori oranı. */
  readonly commission: DiscountCommissionInputs;
}

/** Toplu çözümlemenin sonucu: motor bağlamı + kalem başına girdiler + tarife şeffaflığı. */
export interface CampaignEconomics {
  readonly ctx: TariffAssemblyContext;
  readonly byItemId: ReadonlyMap<string, CampaignItemEconomics>;
  /** Bantları besleyen komisyon tarifesi ve dönemi; kapsayan hafta yoksa null. */
  readonly tariffName: string | null;
  readonly periodLabel: string | null;
  /** Mağazanın tarifesi var ama hiçbiri çapayı kapsamıyorsa true; hiç tarifesi yoksa false. */
  readonly tariffOutdated: boolean;
}

/** Çözümlemenin kalem başına ihtiyaç duyduğu tek şey: kimlik, varyant bağı ve barkod. */
export interface CampaignEconomicsRow {
  readonly id: string;
  readonly productVariantId: string | null;
  readonly barcode: string;
}

/**
 * Verilen kalemlerin fiyatlama girdilerini TEK toplu geçişte çözer.
 *
 * Sırasıyla: eşleşen varyantlar (+ senkronlanan komisyon oranı + ilk görsel), maliyet toplamları
 * ve kargo tahminleri (paralel), kampanya başlangıcına çapalanmış komisyon tarifesi bantları,
 * ve her ayrı (kategori, marka) çifti için bir kez kategori oranı yedeği.
 *
 * Bantlar YALNIZCA çapa anını KAPSAYAN bir tarife haftasından gelir — kapsayan hafta yoksa bant
 * yoktur ve zincir ürün/kategori oranına düşer. Çözümleyici İndirimler ile ORTAK
 * (`resolveDiscountCommissionSource`); bu dikey kendi çözümleyicisini yazmaz.
 *
 * Görsel, kalem sayısından bağımsız olarak HER çağrıda çekilir. Tek kalemlik kâr-dökümü çağrısı
 * onu kullanmaz, ama koşullu bir `select` iki ayrı sorgu şekli demek olurdu ve bu modülün tüm
 * varlık sebebi tek sorgu şeklidir; maliyeti zaten aynı küme üzerinde koşan maliyet/kargo
 * çözümlemelerinin yanında ihmal edilebilir bir lateral join.
 */
export async function resolveCampaignEconomics(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  anchor: Date | null,
  items: ReadonlyArray<CampaignEconomicsRow>,
): Promise<CampaignEconomics> {
  const variantIds = items.map((i) => i.productVariantId).filter((id): id is string => id !== null);

  const variantMap = new Map<
    string,
    TariffVariant & { syncedCommissionRate: Decimal | null; imageUrl: string | null }
  >();
  let costMap = new Map<string, VariantCostAggregate>();
  let shippingMap = new Map<string, EstimateOutcome>();

  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: {
          id: true,
          stockCode: true,
          barcode: true,
          salePrice: true,
          vatRate: true,
          isDigital: true,
          syncedCommissionRate: true,
          product: {
            select: {
              title: true,
              categoryId: true,
              brandId: true,
              imageUrls: true,
            },
          },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      variantMap.set(variant.id, {
        ...variant,
        syncedCommissionRate:
          variant.syncedCommissionRate !== null
            ? new Decimal(variant.syncedCommissionRate.toString())
            : null,
        imageUrl: variant.product.imageUrls[0] ?? null,
      });
    }

    [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, variantIds),
      batchResolveShipping(orgId, storeId, variantIds),
    ]);
  }

  const { resolution: source, outdated } = await resolveDiscountCommissionSource(
    orgId,
    storeId,
    anchor,
    new Date(),
  );

  // Kategori oranı yedeği (3. kademe) — ayrı her (kategori, marka) çifti için tek çözüm.
  const categoryRateByKey = new Map<string, Decimal | null>();
  const distinctCatKeys = new Map<string, { categoryId: bigint; brandId: bigint | null }>();
  for (const variant of variantMap.values()) {
    const { categoryId, brandId } = variant.product;
    if (categoryId === null) continue;
    distinctCatKeys.set(categoryRateKey(categoryId, brandId), { categoryId, brandId });
  }
  await Promise.all(
    [...distinctCatKeys].map(async ([key, { categoryId, brandId }]) => {
      const resolved = await resolveCommissionRate({
        platform: store.platform,
        categoryId,
        brandId,
        sellerSegment: null,
      });
      categoryRateByKey.set(key, resolved?.rate ?? null);
    }),
  );

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));

  const byItemId = new Map<string, CampaignItemEconomics>();
  for (const item of items) {
    const variantRow =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const categoryRate =
      variantRow !== undefined && variantRow.product.categoryId !== null
        ? (categoryRateByKey.get(
            categoryRateKey(variantRow.product.categoryId, variantRow.product.brandId),
          ) ?? null)
        : null;

    byItemId.set(item.id, {
      variant: variantRow ?? null,
      imageUrl: variantRow?.imageUrl ?? null,
      cost: item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined,
      shipping:
        item.productVariantId !== null
          ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
          : NO_SHIPPING,
      commission: {
        // Kalemin kendi `hasCommissionTariff` bayrağı Trendyol'un DOSYA hakkındaki iddiasıdır,
        // mağazanın gerçekten ne yüklediği hakkında değil — arama o bayrağa bağlanmaz, bant
        // haritası tek gerçektir.
        bands: source?.bandsByBarcode.get(item.barcode) ?? null,
        productRate: variantRow?.syncedCommissionRate ?? null,
        categoryRate,
      },
    });
  }

  return {
    ctx: { platform: store.platform, feeDefs },
    byItemId,
    tariffName: source?.tariffName ?? null,
    periodLabel: source?.periodLabel ?? null,
    tariffOutdated: outdated,
  };
}

/** Kategori oranı önbelleğinin anahtarı — iki çağrı yerinde de AYNI biçim. */
function categoryRateKey(categoryId: bigint, brandId: bigint | null): string {
  return `${categoryId}:${brandId ?? 'null'}`;
}

/** Boş girdiye çözümlenmiş, sorgusuz bir kalem — eşleşmesi olmayan satırların yedeği. */
export const EMPTY_ITEM_ECONOMICS: CampaignItemEconomics = {
  variant: null,
  imageUrl: null,
  cost: undefined,
  shipping: NO_SHIPPING,
  commission: { bands: null, productRate: null, categoryRate: null },
};
