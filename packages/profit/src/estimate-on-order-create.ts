/**
 * "Tahmini kâr" hesabı — design §4.2 + 2026-06-13 §5 (kargo rafinesi).
 *
 * `applyEstimateOnOrderCreate(orderId, tx)` her order upsert'te (T+0 + her re-sync)
 * çağrılır:
 *   1. PSF (Platform Hizmet Bedeli) deterministic per-order — muafiyet kontrolü ile
 *   2. Stopaj (E-ticaret Stopajı) deterministic per-order
 *   3. Kargo tahmini (order-level estimator; desi = cargoDeci ?? adet-ağırlıklı
 *      ortalama) → SHIPPING ESTIMATE OrderFee (upsert)
 *   4. `computeProfit()` + `Order.estimatedNetProfit` yaz
 *
 * **Rafine edilebilir (write-MANY)** — design 2026-06-13: estimatedNetProfit artık
 * write-once DEĞİL. Kargoya verilip `cargoDeci` gelince fonksiyon yeniden çağrılır
 * ve kargo bedeli rafine olur. Idempotent: PSF/Stopaj skip-if-exists, SHIPPING
 * upsert, maliyet snapshot DB-immutable → aynı (veya kargo-rafine) sonuç.
 *
 * **Maliyet snapshot eksikse**: herhangi bir item'ın `unitCostSnapshotGross`'u null
 * ise `estimatedNetProfit` null bırakılır (cost sonradan gelince re-entry yazar).
 *
 * **Kâr-dışı sipariş** (`profitExcludedAt !== null`): ne fee ne estimate yazılır.
 *
 * Modül `packages/profit/`'te yaşar — apps/api + apps/sync-worker ortak tüketici.
 */

import { Decimal } from 'decimal.js';

import type { Prisma } from '@pazarsync/db';
import { syncLog } from '@pazarsync/sync-core';
import {
  resolveProfitSettings,
  resolveSnapshotProfitSettings,
  type ResolvedProfitSettings,
} from '@pazarsync/utils';

import { inferShippedSameDay } from './infer-shipped-same-day';
import { computeReturnScenario } from './compute-return-scenario';
import { foldReturnLegs, resolveReturnLegs, type ReturnFeeRow } from './fold-return-legs';
import { grossToVat } from './money';
import { computeProfit, type ProfitInputFee } from './profit-formula';
import { isMicroExport, isPsfExempt, resolveFeeDefinition } from './resolve-fee-definition';
import { estimateShippingCostForOrder } from './shipping/estimate-order-shipping';

/**
 * Computes and persists `Order.estimatedNetProfit` (refinable) along with the
 * supporting ESTIMATE-source OrderFee rows (PSF + Stopaj + Shipping).
 *
 * Idempotent — safe to call multiple times. Re-entry refines the estimate
 * (esp. shipping once `cargoDeci` lands); it does NOT early-return on a
 * non-null estimate.
 */
export async function applyEstimateOnOrderCreate(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { productVariant: true } },
      store: true,
    },
  });
  if (order === null) return;

  // Kâr rafinesi (design 2026-06-13): estimatedNetProfit artık WRITE-ONCE DEĞİL.
  // Kargo bilgisi geldikçe (T+0 ürün-desi → kargoya verilince cargoDeci) yeniden
  // hesaplanır, bu yüzden estimatedNetProfit dolu olsa bile erken return YOK.
  // Fonksiyon idempotent: PSF/Stopaj skip-if-exists, SHIPPING upsert, maliyet
  // snapshot DB-immutable → tekrar çağrı aynı (veya kargo-rafine) sonucu verir.

  // Kâr-dışı sipariş: ne fee ne estimate — kalıcı donuk (spec 2026-06-12).
  if (order.profitExcludedAt !== null) return;

  // ─── Kâr formülü ayar snapshot'ı (write-once, snapshot-at-create) ──────
  // İLK hesapta mağazanın CANLI ayarını (Store.profitSettings) çöz + Order'a yaz.
  // Re-entry'de (kargo rafinesi / variant-resolution / psf) snapshot DOLU → canlı ayarı
  // OKUMA, snapshot'ı koru. Maliyet snapshot ile aynı write-once felsefesi: mağaza ayarı
  // sonradan değişse bile bu siparişin stopaj/negatif-KDV davranışı sabit kalır; ayar
  // değişimi yalnız BUNDAN SONRA yaratılan siparişleri etkiler. resolve* @pazarsync/utils.
  const snapshotMissing =
    order.snapshotIncludeStopaj === null || order.snapshotIncludeNegativeNetVat === null;
  let profitSettings: ResolvedProfitSettings;
  if (snapshotMissing) {
    const live = resolveProfitSettings(order.store.profitSettings);
    // Mikro ihracat YAPISAL kuralı: satış KDV %0 (ihracat istisnası) + ürün girdi-KDV'si
    // netVat ile mahsup edilir (KDV iadesi, satıcı lehine — profit-formula.md §10) → negatif
    // net KDV mikro'da DAİMA dahildir; mağazanın "negatif net KDV hariç" tercihi (domestik
    // düşük-KDV ürünler içindir) mikro'yu EZEMEZ. Snapshot'a EFEKTİF politika yazılır; böylece
    // settled tekrar mikro kontrolü yapmadan snapshot'ı okur. Stopaj zaten ayrı `!isMicroExport`
    // gate'iyle mikro'da yazılmaz → snapshotIncludeStopaj canlı tercihi olduğu gibi taşır.
    profitSettings = {
      includeStopaj: live.includeStopaj,
      includeNegativeNetVat: isMicroExport(order) ? true : live.includeNegativeNetVat,
    };
    await tx.order.update({
      where: { id: orderId },
      data: {
        snapshotIncludeStopaj: profitSettings.includeStopaj,
        snapshotIncludeNegativeNetVat: profitSettings.includeNegativeNetVat,
      },
    });
  } else {
    profitSettings = resolveSnapshotProfitSettings(order);
  }

  // Re-entry fee guard: fonksiyon her sync'te yeniden çağrılır (maliyet backfill,
  // variant-resolution tick, sevk re-sync). Çift-fee'yi önlemek için: Stopaj
  // DETERMİNİSTİK → feeType-başına skip-if-exists (bu set). PSF ise REFINABLE
  // (SameDayShipping rate'i sevkte 6.99↔10.99 değişir) → upsert (aşağıda, SHIPPING
  // gibi). Kargo da upsert. Hepsi tek satır → computeProfit hiçbirini 2× saymaz.
  const existingEstimateFeeTypes = new Set(
    (
      await tx.orderFee.findMany({
        where: { orderId, source: 'ESTIMATE' },
        select: { feeType: true },
      })
    ).map((fee) => fee.feeType),
  );

  // ─── 1. PSF (Platform Hizmet Bedeli) — refinable, SameDayShipping-aware ─
  // Muafiyetler: RETURNED, micro=true, all-digital → PSF=0 (OrderFee yazılmaz).
  //
  // SameDayShipping ("Bugün Kargoda") indirimi (6.99 vs 10.99) — resmi Trendyol
  // kuralı (2026-06-14): YALNIZ fastDeliveryType==='SameDayShipping' + aynı-gün
  // SEVK (taşıma durumuna geçiş = actualShipDate). FastDelivery/TodayDelivery
  // indirimi ALMAZ → standart 10.99. Cutoff Trendyol'un sipariş-uygunluk kapısı
  // (etiketi o veriyor) → biz tekrar bakmayız.
  //
  // REFINABLE (SHIPPING gibi upsert): T+0'da actualShipDate null → OPTİMİSTİK 6.99;
  // sevk re-sync'inde aynı-gün-sevk DEĞİLSE 10.99'a refine olur (hakediş GELMEDEN).
  // inferShippedSameDay: null=henüz sevk yok (optimistik), true=aynı gün, false=geç.
  if (!isPsfExempt(order)) {
    const earnsSameDayPsf =
      order.fastDeliveryType === 'SameDayShipping' && inferShippedSameDay(order) !== false;
    const psfDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: earnsSameDayPsf ? 'PLATFORM_SERVICE_FAST' : 'PLATFORM_SERVICE',
      at: order.orderDate,
    });
    if (psfDef.fixedAmountNet === null) {
      throw new Error(`${psfDef.feeType} FeeDefinition ${psfDef.id} missing fixedAmountNet`);
    }
    // GROSS konvansiyon (2026-06-16): FeeDefinition referans verisi NET saklar
    // (fixedAmountNet + defaultVatRate); fee yazımında GROSS'a çevrilir:
    // amountGross = fixedAmountNet × (100 + vatRate)/100. Net/KDV downstream türetilir.
    const psfVatRate = new Decimal(psfDef.defaultVatRate);
    const psfGross = new Decimal(psfDef.fixedAmountNet)
      .mul(new Decimal(100).add(psfVatRate))
      .div(100)
      .toDecimalPlaces(2);

    // Tek PLATFORM_SERVICE ESTIMATE satırı (confirmation + recompute bunu key'ler);
    // FAST rate'te feeDefinitionId FAST satırına + displayName "Bugün Kargoda".
    // Refinable: sevk re-sync'inde rate (6.99↔10.99) güncellenir; çift-PSF yok.
    const psfData = {
      feeDefinitionId: psfDef.id,
      amountGross: psfGross,
      vatRate: psfVatRate,
      displayName: psfDef.displayName,
    };
    const existingPsf = await tx.orderFee.findFirst({
      where: { orderId, feeType: 'PLATFORM_SERVICE', source: 'ESTIMATE' },
      select: { id: true },
    });
    if (existingPsf !== null) {
      await tx.orderFee.update({ where: { id: existingPsf.id }, data: psfData });
    } else {
      await tx.orderFee.create({
        data: {
          orderId,
          organizationId: order.organizationId,
          feeType: 'PLATFORM_SERVICE',
          source: 'ESTIMATE',
          direction: 'DEBIT',
          ...psfData,
        },
      });
    }
  }

  // ─── 2. Stopaj (E-ticaret Stopajı) — deterministic per-order ───────────
  // Matrah: NET satış (KDV-hariç) × %1 (KDV=0; stopaj KDV taşımaz). Stopaj KDV-dahil
  // tutardan DEĞİL, KDV'siz satıştan hesaplanır (design Bölüm 1: "Stopaj =
  // (satışGross − satışKDV) × %1"; rakip/Trendyol gerçek değeri de net üzerinden).
  // PSF üzerine stopaj YAPILMAZ (design §3.4 — 330 Tebliği Md 5/2). GROSS konvansiyon:
  // amountGross = (saleGross − saleVat) × rateOfSale. Stopaj YAPISAL olarak KDV
  // taşımaz (vergi tevkifatı) → vatRate verilmez; OrderFee.vat_rate kolonu @default(0).
  // Mikro ihracat: stopaj ŞİMDİLİK uygulanmaz (canlı hakediş verisinden doğrulanacak —
  // Trendyol ürünü satın aldığı + komisyon kesmediği için %1 e-ticaret stopajı bu modelde
  // geçerli görünmüyor). Doğrulanırsa bu tek `!isMicroExport` koşulu kaldırılır + doküman
  // güncellenir (plan: resilient-sauteeing-milner.md "Stopaj — açık nokta").
  // Mağaza ayarı (snapshot): includeStopaj=false ise STOPPAGE OrderFee HİÇ yazılmaz →
  // computeProfit'in `stoppage` terimi 0 olur ve settled tarafı da (yalnız var olan ESTIMATE
  // STOPPAGE'ı okur) doğal olarak stopaj görmez. Snapshot write-once olduğu için re-entry'de
  // canlı ayar değil snapshot belirleyicidir.
  if (
    order.saleGross !== null &&
    order.saleVat !== null &&
    !isMicroExport(order) &&
    profitSettings.includeStopaj &&
    !existingEstimateFeeTypes.has('STOPPAGE')
  ) {
    const stopajDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'STOPPAGE',
      at: order.orderDate,
    });
    if (stopajDef.rateOfSale === null) {
      throw new Error(`STOPPAGE FeeDefinition ${stopajDef.id} missing rateOfSale`);
    }
    const saleNet = new Decimal(order.saleGross).sub(new Decimal(order.saleVat));
    const stopajGross = saleNet.mul(new Decimal(stopajDef.rateOfSale)).toDecimalPlaces(2);

    await tx.orderFee.create({
      data: {
        orderId,
        organizationId: order.organizationId,
        feeDefinitionId: stopajDef.id,
        feeType: 'STOPPAGE',
        source: 'ESTIMATE',
        direction: 'DEBIT',
        amountGross: stopajGross,
        displayName: stopajDef.displayName,
      },
    });
  }

  // ─── 3. Shipping estimate (order-level, design 2026-06-13 §3) ──────────
  // Desi = cargoDeci ?? ürün-ayarı adet-ağırlıklı ortalama → Barem/desi tarifesi.
  // SHIPPING ESTIMATE fee (DEBIT) estimatedNetProfit'i besler. CONFIRMABLE_FEE_TYPES'ta
  // DEĞİL → settled kâra girmez (gerçek CARGO_INVOICE settled'ı besler; çift-sayım yok).
  // Re-entry'de (cargoDeci dolunca / cost backfill) UPSERT: mevcut fee güncellenir.
  // Üretilemezse (carrier yok / desi taşma / own boş) fee yazılmaz, loglanır.
  const shippingOutcome = await estimateShippingCostForOrder(orderId, tx);
  if (shippingOutcome.ok) {
    const shipDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'SHIPPING',
      at: order.orderDate,
    });
    // GROSS konvansiyon: tarife tablosu priceNet saklar (estimate.amount = net);
    // fee GROSS yazılır: amountGross = priceNet × (100 + vatRate)/100.
    const shipVatRate = new Decimal(shipDef.defaultVatRate);
    const shipGross = shippingOutcome.estimate.amount
      .mul(new Decimal(100).add(shipVatRate))
      .div(100)
      .toDecimalPlaces(2);
    const existingShip = await tx.orderFee.findFirst({
      where: { orderId, feeType: 'SHIPPING', source: 'ESTIMATE' },
      select: { id: true },
    });
    if (existingShip !== null) {
      await tx.orderFee.update({
        where: { id: existingShip.id },
        data: { amountGross: shipGross, vatRate: shipVatRate },
      });
    } else {
      await tx.orderFee.create({
        data: {
          orderId,
          organizationId: order.organizationId,
          feeDefinitionId: shipDef.id,
          feeType: 'SHIPPING',
          source: 'ESTIMATE',
          direction: 'DEBIT',
          amountGross: shipGross,
          vatRate: shipVatRate,
          displayName: shipDef.displayName,
        },
      });
    }
  } else {
    syncLog.warn('estimate.shipping.unavailable', {
      orderId,
      reason: shippingOutcome.reason,
    });
  }

  // ─── 3b. Uluslararası Hizmet Bedeli (yalnız mikro ihracat) ─────────────
  // Trendyol: mikro ihracat siparişlerinde PSF UYGULANMAZ; bunun yerine ürün satışı
  // üzerinden %6 KDV-dahil "Uluslararası Hizmet Bedeli" kesilir (16.07.2024'ten beri,
  // tüm bölgeler). Taban: Trendyol-karşılamalı indirimler HARİÇ, satıcı indirimi düşülmüş
  // satış = listGross − sellerDiscountGross (saleGross TY indirimini de düştüğünden taban
  // DEĞİL). YALNIZ iptale dönen siparişte uygulanmaz (RETURNED'de uygulanır — satış
  // gerçekleşmiştir, iadenin ayrı "Yurt Dışı İade Operasyon Bedeli"si vardır). Refinable
  // (UPSERT, PSF gibi); oran data-driven (FeeDefinition.rateOfSale). Taban inceliği gerçek
  // hakediş ücretiyle doğrulanacak (plan: resilient-sauteeing-milner.md).
  if (isMicroExport(order) && order.saleGross !== null) {
    const existingIntl = await tx.orderFee.findFirst({
      where: { orderId, feeType: 'INTERNATIONAL_SERVICE', source: 'ESTIMATE' },
      select: { id: true },
    });
    if (order.status === 'CANCELLED') {
      // İptale dönen mikro ihracat: ücret kalmamalı (önceki tahmin temizlenir).
      if (existingIntl !== null) {
        await tx.orderFee.delete({ where: { id: existingIntl.id } });
      }
    } else {
      const intlDef = await resolveFeeDefinition(tx, {
        platform: order.store.platform,
        feeType: 'INTERNATIONAL_SERVICE',
        at: order.orderDate,
      });
      if (intlDef.rateOfSale === null) {
        throw new Error(`INTERNATIONAL_SERVICE FeeDefinition ${intlDef.id} missing rateOfSale`);
      }
      // Taban: effectiveSaleGross = listGross − sellerDiscountGross (TY-fonlu indirim HARİÇ).
      // listGross/sellerDiscountGross şemada nullable; saleGross dolu olduğunda (yukarıdaki
      // koşul) upsert üçünü birlikte yazar → pratikte dolu. Defansif ?? 0.
      const intlBase = new Decimal(order.listGross ?? 0).sub(
        new Decimal(order.sellerDiscountGross ?? 0),
      );
      // %6 KDV-DAHİL → amountGross = base × rateOfSale (GROSS); KDV bileşeni downstream
      // grossToVat ile defaultVatRate'ten türetilir.
      const intlGross = intlBase.mul(new Decimal(intlDef.rateOfSale)).toDecimalPlaces(2);
      const intlData = {
        feeDefinitionId: intlDef.id,
        amountGross: intlGross,
        vatRate: new Decimal(intlDef.defaultVatRate),
        displayName: intlDef.displayName,
      };
      if (existingIntl !== null) {
        await tx.orderFee.update({ where: { id: existingIntl.id }, data: intlData });
      } else {
        await tx.orderFee.create({
          data: {
            orderId,
            organizationId: order.organizationId,
            feeType: 'INTERNATIONAL_SERVICE',
            source: 'ESTIMATE',
            direction: 'DEBIT',
            ...intlData,
          },
        });
      }
    }
  }

  // ─── 4. ProfitInput (GROSS) kur + computeProfit + Order.estimated* yaz ──
  // Tüm cost snapshot'lar dolu mu? Eksikse profit null kalır (kâr-dondurma).
  const allHaveCostSnapshot = order.items.every(
    (item) => item.unitCostSnapshotGross !== null && item.unitCostSnapshotVatRate !== null,
  );
  if (!allHaveCostSnapshot || order.saleGross === null || order.saleVat === null) {
    // Maliyet snapshot eksik veya satış agregat'ı set'lenmemiş → profit null kalır.
    // Cost profile sonradan eklenirse caller bu fonksiyonu tekrar çağırır.
    //
    // NOT dead after PR-B's calculability gate: the gate only guarantees cost
    // at the sync boundary (webhook + cron). upsertOrderWithSnapshot has direct
    // callers that bypass it, and this branch also guards the sale-aggregate
    // nullability the gate never checks. Keep it — fail safe.
    return;
  }

  // Maliyet + komisyon GROSS agregatları (item × adet). Komisyon net-satış tabanı
  // (#332): effective = commissionGross − refundedCommissionGross. KDV oranları
  // item-bazlı (maliyet KDV satıştan bağımsız; komisyon KDV DB-driven #331).
  //
  // KDV türevi TAM PRECISION'da biriktirilir — per-line `.toDecimalPlaces(2)` YOK.
  // Tek yuvarlama persist'te (estimatedNetVat/estimatedNetProfit → toDecimalPlaces(2)).
  // Bu, build-profit-breakdown.ts'in (görünüm yolu) raw-aggregate yöntemiyle BİREBİR
  // uyuşur; çok-kalemli siparişte per-line yuvarlama bileşik kuruş kaymasına yol açardı.
  let costGross = new Decimal(0);
  let costVat = new Decimal(0);
  let commissionGross = new Decimal(0);
  let commissionVat = new Decimal(0);
  for (const item of order.items) {
    const qty = new Decimal(item.quantity);
    const lineCost = new Decimal(item.unitCostSnapshotGross ?? 0).mul(qty);
    costGross = costGross.add(lineCost);
    costVat = costVat.add(grossToVat(lineCost, new Decimal(item.unitCostSnapshotVatRate ?? 0)));
    const effComm = new Decimal(item.commissionGross).sub(
      new Decimal(item.refundedCommissionGross),
    );
    commissionGross = commissionGross.add(effComm);
    commissionVat = commissionVat.add(grossToVat(effComm, new Decimal(item.commissionVatRate)));
  }

  // PSF + Kargo + Uluslararası Hizmet Bedeli + Yurt Dışı İade Operasyon Bedeli (mikro
  // ihracat) ESTIMATE fee'leri (Stopaj motorda ayrı `stoppage` terimidir — fee listesine
  // GİRMEZ, çift sayım olmaz).
  const estimateFees = await tx.orderFee.findMany({
    where: {
      orderId,
      source: 'ESTIMATE',
      feeType: {
        in: ['SHIPPING', 'PLATFORM_SERVICE', 'INTERNATIONAL_SERVICE', 'OVERSEAS_RETURN_OPERATION'],
      },
    },
    select: { feeType: true, amountGross: true, vatRate: true, direction: true },
  });
  const profitInputFees: ProfitInputFee[] = estimateFees.map((fee) => ({
    type:
      fee.feeType === 'SHIPPING'
        ? 'SHIPPING'
        : fee.feeType === 'INTERNATIONAL_SERVICE'
          ? 'INTERNATIONAL_SERVICE'
          : fee.feeType === 'OVERSEAS_RETURN_OPERATION'
            ? 'OVERSEAS_RETURN_OPERATION'
            : 'PLATFORM_SERVICE',
    gross: new Decimal(fee.amountGross),
    // KDV tam precision (per-fee yuvarlama YOK); tek yuvarlama persist'te.
    vat: grossToVat(new Decimal(fee.amountGross), new Decimal(fee.vatRate)),
    direction: fee.direction,
  }));

  // Stopaj = (saleGross − saleVat) × %1 (net satış, KDV=0) — motor `stoppage` terimi
  // (netVat'a girmez, doğrudan netProfit'ten düşülür).
  const stoppageFee = await tx.orderFee.findFirst({
    where: { orderId, feeType: 'STOPPAGE', source: 'ESTIMATE' },
    select: { amountGross: true },
  });

  // İade bacakları (ESTIMATE yolu): tüm 4 iade feeType'ı, source/confirmedAt filtresi YOK.
  // Settled yolunun aksine (yalnız gerçek + onaylı ESTIMATE), tahmin yolunda UNCONFIRMED
  // ESTIMATE iade satırları da katlanır — satıcıya T+0'da iade etkisini gösterir.
  // resolveReturnLegs gerçek-varsa-gerçek (SETTLEMENT/CARGO_INVOICE) öncelik verir;
  // bu sorgu hem gerçeği hem tahmini çektiğinden resolver kararı doğal.
  const returnFeeRows = await tx.orderFee.findMany({
    where: {
      orderId,
      feeType: {
        in: [
          'REFUND_DEDUCTION',
          'COMMISSION_REFUND',
          'COST_RETURN',
          'RETURN_SHIPPING',
          'STOPPAGE_REFUND',
        ],
      },
    },
    select: { feeType: true, source: true, amountGross: true, vatRate: true },
  });

  // DB enums (OrderFeeType / OrderFeeSource) are supersets of the helper's
  // string-literal unions. The `as` casts are safe: the `where` filter above
  // guarantees only the four return feeTypes, and their sources are always
  // ESTIMATE/SETTLEMENT/CARGO_INVOICE (the full ReturnFeeRow['source'] union).
  const returnLegs = resolveReturnLegs(
    returnFeeRows.map(
      (f): ReturnFeeRow => ({
        feeType: f.feeType as ReturnFeeRow['feeType'],
        source: f.source as ReturnFeeRow['source'],
        amountGross: new Decimal(f.amountGross),
        vatRate: new Decimal(f.vatRate),
      }),
    ),
  );

  const baseProfitInput = {
    sale: { gross: new Decimal(order.saleGross), vat: new Decimal(order.saleVat) },
    cost: { gross: costGross, vat: costVat },
    commission: { gross: commissionGross, vat: commissionVat },
    fees: profitInputFees,
    stoppage: { gross: new Decimal(stoppageFee?.amountGross ?? 0) },
    includeNegativeNetVat: profitSettings.includeNegativeNetVat,
  };

  const profit = computeProfit(foldReturnLegs(baseProfitInput, returnLegs));

  // İade senaryosu: zaten gerçek iade bacağı varsa senaryo anlamsız → null
  // (gerçek iade kâr dökümünde zaten gösteriliyor). Aksi halde tam-iade
  // senaryosunu base input'tan (iade-öncesi) hesapla.
  // Domestik iadelerde returnFeeRows dolu; mikro iadelerde bunlar YOK, bunun
  // yerine OVERSEAS_RETURN_OPERATION estimate yazılır → her iki durumu da kontrol et.
  const hasReturnFees =
    returnFeeRows.length > 0 || existingEstimateFeeTypes.has('OVERSEAS_RETURN_OPERATION');
  const returnScenario = hasReturnFees
    ? null
    : await computeReturnScenario(baseProfitInput, order, tx);

  await tx.order.update({
    where: { id: orderId },
    data: {
      estimatedNetProfit: profit.netProfit.toDecimalPlaces(2),
      estimatedNetVat: profit.netVat.toDecimalPlaces(2),
      estimatedSaleMarginPct: profit.saleMarginPct?.toDecimalPlaces(4) ?? null,
      estimatedCostMarkupPct: profit.costMarkupPct?.toDecimalPlaces(4) ?? null,
      estimatedReturnScenarioNetProfit: returnScenario?.netProfit.toDecimalPlaces(2) ?? null,
      estimatedReturnScenarioMarginPct: returnScenario?.saleMarginPct?.toDecimalPlaces(4) ?? null,
    },
  });
}
