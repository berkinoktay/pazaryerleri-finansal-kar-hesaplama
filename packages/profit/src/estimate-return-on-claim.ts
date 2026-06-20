/**
 * İade kabul edildiğinde 4 iade bacağı için ERKEN TAHMİN yazar (return-into-profit
 * Task 5). İade onaylanır onaylanmaz satıcı zararı (satışın geri ödenmesi, komisyon
 * iadesi, maliyet geri dönüşü, iade kargosu) anında görünsün diye `source: 'ESTIMATE'`
 * OrderFee satırları üretir; gerçek hakediş/kargo faturası geldiğinde Task 3/4
 * bunları per-leg gerçek değerlerle mutabık kılar.
 *
 * Kabul edilen iade birimleri: `OrderClaimItem` Trendyol'da PER-UNIT'tir (3 birimlik
 * iade 3 satır üretir; bkz. schema @@unique([claimId, trendyolClaimItemId])). Bu
 * yüzden kabul edilen birim SAYISI orderItemId başına gruplanır → acceptedQty.
 *
 * Bacak başına TEK agregat ESTIMATE satırı yazılır (kabul edilen birimler toplanır).
 * Bunu `order_fees_estimate_fee_type_uniq = (order_id, fee_type) WHERE source='ESTIMATE'`
 * partial unique index ZORUNLU kılar: bacak tipi başına yalnız bir ESTIMATE satır
 * olabilir → prisma upsert DEĞİL, find-then-update-or-create (estimate-on-order-create.ts
 * PSF/SHIPPING ESTIMATE upsert'leriyle aynı desen).
 *
 * Çok-kategorili (farklı KDV oranlı) siparişte: agregat satır TEK KDV oranı taşır →
 * tek-kategoride TAM, çok-kategoride dokümante edilmiş AĞIRLIKLI YAKLAŞIM (gerçek
 * kargo faturası/hakediş sonradan per-leg mutabık kılar). Tek-item dosyalarında
 * (büyük çoğunluk) bu hiç devreye girmez.
 *
 * Kâr-dışı sipariş (`profitExcludedAt !== null`): hiçbir şey yazılmaz (kalıcı donuk).
 *
 * Bitişte `applyEstimateOnOrderCreate` çağrılır → estimatedNetProfit iade-farkında
 * yeniden hesaplanır (fold-return-legs ESTIMATE iade satırlarını katlar).
 */

import { Decimal } from 'decimal.js';

import type { OrderFeeDirection, Prisma } from '@pazarsync/db';

import { applyEstimateOnOrderCreate } from './estimate-on-order-create';
import type { ReturnFeeType } from './fold-return-legs';
import { resolveFeeDefinition } from './resolve-fee-definition';
import { estimateShippingCostForOrder } from './shipping/estimate-order-shipping';

const ZERO = new Decimal(0);
const ACCEPTED_STATUS = 'Accepted';

/**
 * İade bacaklarının görünen adları (ücret zaman çizgisi başlığı). "(tahmini)" eki
 * KASTEN yok: kesinleşmemiş/kesinleşmiş ayrımını UI'daki kaynak rozeti ("Kesinleşmemiş")
 * taşır → başlıkta tekrar etmez. Etiketler i18n `orderDetail.fees.types.*` ile hizalı.
 */
const RETURN_LEG_DISPLAY_NAMES: Record<ReturnFeeType, string> = {
  REFUND_DEDUCTION: 'İade kesintisi',
  COMMISSION_REFUND: 'Komisyon iadesi',
  COST_RETURN: 'Maliyet iadesi',
  RETURN_SHIPPING: 'İade kargosu',
  STOPPAGE_REFUND: 'Stopaj iadesi',
} as const;

/**
 * Bacak yönleri (fold-return-legs ile tutarlı): satışın geri ödenmesi satıcıya
 * BORÇ (DEBIT); komisyon ve maliyet geri dönüşü satıcı LEHİNE (CREDIT); iade
 * kargosu satıcıya BORÇ (DEBIT).
 */
const RETURN_LEG_DIRECTIONS: Record<ReturnFeeType, OrderFeeDirection> = {
  REFUND_DEDUCTION: 'DEBIT',
  COMMISSION_REFUND: 'CREDIT',
  COST_RETURN: 'CREDIT',
  RETURN_SHIPPING: 'DEBIT',
  STOPPAGE_REFUND: 'CREDIT',
} as const;

interface UpsertReturnEstimateFeeArgs {
  orderId: string;
  organizationId: string;
  feeType: ReturnFeeType;
  direction: OrderFeeDirection;
  amountGross: Decimal;
  vatRate: Decimal;
  displayName: string;
  feeDefinitionId?: string;
}

/**
 * Bir iade bacağını TEK ESTIMATE OrderFee satırı olarak yazar (find-then-update-or-create).
 * Partial unique index (order_id, fee_type) WHERE source='ESTIMATE' nedeniyle prisma
 * upsert kullanılamaz → mevcut satır varsa güncelle, yoksa oluştur.
 */
async function upsertReturnEstimateFee(
  tx: Prisma.TransactionClient,
  args: UpsertReturnEstimateFeeArgs,
): Promise<void> {
  const amountGross = args.amountGross.toDecimalPlaces(2);
  const data = {
    amountGross,
    vatRate: args.vatRate,
    direction: args.direction,
    displayName: args.displayName,
    feeDefinitionId: args.feeDefinitionId ?? null,
  };

  const existing = await tx.orderFee.findFirst({
    where: { orderId: args.orderId, feeType: args.feeType, source: 'ESTIMATE' },
    select: { id: true },
  });

  if (existing !== null) {
    await tx.orderFee.update({ where: { id: existing.id }, data });
    return;
  }

  await tx.orderFee.create({
    data: {
      orderId: args.orderId,
      organizationId: args.organizationId,
      feeType: args.feeType,
      source: 'ESTIMATE',
      ...data,
    },
  });
}

/** Bacak tipi başına biriktirilen gross + (tek) KDV oranı. */
interface LegAccumulator {
  gross: Decimal;
  vatRate: Decimal;
}

/**
 * Kabul edilen iade birimleri için 4 iade bacağını ESTIMATE OrderFee olarak yazar
 * ve estimatedNetProfit'i iade-farkında yeniden hesaplar.
 *
 * Idempotent: tekrar çağrı mevcut ESTIMATE iade satırlarını günceller (çift-yazım yok).
 */
export async function estimateReturnOnClaim(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, store: true },
  });
  if (order === null) return;

  // Kâr-dışı sipariş: kâr hesabı yapılmaz (kalıcı donuk, spec 2026-06-12).
  if (order.profitExcludedAt !== null) return;

  // Kabul edilen (terminal accepted = iade gerçekleşti) iade birimlerini bul.
  // Reddedilen/iptal edilen claim item'lar dahil edilmez; orderItemId null olanlar
  // (henüz eşleşmemiş) kâr etkisi hesaplanamaz → atlanır.
  const acceptedItems = await tx.orderClaimItem.findMany({
    where: {
      claim: { orderId },
      status: ACCEPTED_STATUS,
      orderItemId: { not: null },
    },
    select: { orderItemId: true },
  });
  // Hiç kabul edilmiş birim yok → yazacak/temizlenecek bir şey yok, çık.
  // DEĞİŞMEZ (Trendyol + Berkin 2026-06-20): 'Accepted' TERMİNAL statüdür — satıcı iadeyi
  // onayladıktan sonra geri dönülmez. Tahmini de YALNIZ 'Accepted'da yazıyoruz (müşterinin
  // açtığı ama onaylanmamış Created/WaitingInAction talebinde DEĞİL — o iptal edilebilir).
  // Bu iki gerçek birlikte, daha önce yazılmış bir ESTIMATE iade kaleminin "geri alınması"
  // (rollback) gereğini ortadan kaldırır; bayat/hayalet kalem oluşamaz.
  if (acceptedItems.length === 0) return;

  // orderItemId başına kabul edilen birim SAYISI (her OrderClaimItem = 1 birim).
  const acceptedQtyByItem = new Map<string, number>();
  for (const claimItem of acceptedItems) {
    // where filtresi orderItemId: { not: null } olduğundan burada null değildir;
    // tip daraltma için açık kontrol.
    if (claimItem.orderItemId === null) continue;
    acceptedQtyByItem.set(
      claimItem.orderItemId,
      (acceptedQtyByItem.get(claimItem.orderItemId) ?? 0) + 1,
    );
  }

  // ─── İade bacakları (satış/komisyon/maliyet) — item başına per-unit × kabul ──
  // REFUND_DEDUCTION  = lineSaleGross × (acceptedQty / quantity)
  // COMMISSION_REFUND = commissionGross × (acceptedQty / quantity)
  // COST_RETURN       = unitCostSnapshotGross × acceptedQty
  //
  // KDV oranları item-bazlı taşınır (tek-kategoride TAM; çok-kategoride agregat
  // satır TEK oran taşır → son yazan item'ın oranı = dokümante edilmiş yaklaşım,
  // gerçek hakediş/kargo faturası per-leg mutabık kılar). Çoğu sipariş tek-item.
  const itemsById = new Map(order.items.map((item) => [item.id, item]));

  const refund: LegAccumulator = { gross: ZERO, vatRate: ZERO };
  const commission: LegAccumulator = { gross: ZERO, vatRate: ZERO };
  const cost: LegAccumulator = { gross: ZERO, vatRate: ZERO };

  for (const [orderItemId, acceptedQty] of acceptedQtyByItem) {
    const item = itemsById.get(orderItemId);
    if (item === undefined) continue;

    const quantity = new Decimal(item.quantity);
    // quantity 0 ise per-unit oran tanımsız → bu item'ı atla (veri anomalisi).
    const acceptedRatio = quantity.isZero() ? ZERO : new Decimal(acceptedQty).div(quantity);

    if (item.lineSaleGross !== null) {
      refund.gross = refund.gross.add(new Decimal(item.lineSaleGross).mul(acceptedRatio));
      refund.vatRate = new Decimal(item.saleVatRate);
    }

    commission.gross = commission.gross.add(new Decimal(item.commissionGross).mul(acceptedRatio));
    commission.vatRate = new Decimal(item.commissionVatRate);

    if (item.unitCostSnapshotGross !== null) {
      cost.gross = cost.gross.add(new Decimal(item.unitCostSnapshotGross).mul(acceptedQty));
      cost.vatRate = new Decimal(item.unitCostSnapshotVatRate ?? 0);
    }
  }

  // Yalnız gross > 0 olan bacaklar yazılır (sıfır bacak satır kirletmez).
  await writeLegIfPositive(tx, order.id, order.organizationId, 'REFUND_DEDUCTION', refund);
  await writeLegIfPositive(tx, order.id, order.organizationId, 'COMMISSION_REFUND', commission);
  await writeLegIfPositive(tx, order.id, order.organizationId, 'COST_RETURN', cost);

  // ─── Stopaj iadesi (STOPPAGE_REFUND) — iade edilen satışın stopajı geri alınır ────
  // Stopaj satıştan kesilen %1 vergidir; iade edilen satış için vergiden mahsupla geri
  // döner → satıcı gideri DEĞİL (Berkin kararı 2026-06-20). İade edilen NET satış ×
  // stopaj oranı kadar CREDIT yazılır (fold-return-legs base.stoppage'tan düşer; tam
  // iade → tam geri, kısmi → orantılı). vatRate 0. Diğer bacaklar gibi açık satır →
  // hem kâr matematiğinde netlenir hem ücret zaman çizgisinde "Stopaj iadesi" görünür.
  if (refund.gross.gt(0)) {
    const stopajDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'STOPPAGE',
      at: order.orderDate,
    });
    const stopajRate = new Decimal(stopajDef.rateOfSale ?? 0);
    const refundSaleNet = refund.vatRate.isZero()
      ? refund.gross
      : refund.gross.mul(100).div(new Decimal(100).add(refund.vatRate));
    await writeLegIfPositive(tx, order.id, order.organizationId, 'STOPPAGE_REFUND', {
      gross: refundSaleNet.mul(stopajRate),
      vatRate: ZERO,
    });
  }

  // ─── İade kargosu (RETURN_SHIPPING) — Barem YOK (iade kargosu Barem'e girmez) ─
  // estimateShippingCostForOrder NET tarife döner; RETURN_SHIPPING FeeDefinition'ın
  // defaultVatRate'i ile GROSS'a çevrilir: gross = net × (100 + vatRate)/100.
  const shippingOutcome = await estimateShippingCostForOrder(orderId, tx, { applyBarem: false });
  if (shippingOutcome.ok) {
    const returnShipDef = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'RETURN_SHIPPING',
      at: order.orderDate,
    });
    const vatRate = new Decimal(returnShipDef.defaultVatRate);
    const grossShipping = shippingOutcome.estimate.amount
      .mul(new Decimal(100).add(vatRate))
      .div(100);

    if (grossShipping.gt(0)) {
      await upsertReturnEstimateFee(tx, {
        orderId: order.id,
        organizationId: order.organizationId,
        feeType: 'RETURN_SHIPPING',
        direction: RETURN_LEG_DIRECTIONS.RETURN_SHIPPING,
        amountGross: grossShipping,
        vatRate,
        displayName: RETURN_LEG_DISPLAY_NAMES.RETURN_SHIPPING,
        feeDefinitionId: returnShipDef.id,
      });
    }
  }

  // ─── estimatedNetProfit'i iade-farkında yeniden hesapla ────────────────────
  // applyEstimateOnOrderCreate ESTIMATE iade satırlarını (onaysız dahil) katlar.
  await applyEstimateOnOrderCreate(orderId, tx);
}

/** REFUND_DEDUCTION/COMMISSION_REFUND/COST_RETURN bacağını gross>0 ise yazar. */
async function writeLegIfPositive(
  tx: Prisma.TransactionClient,
  orderId: string,
  organizationId: string,
  feeType: Exclude<ReturnFeeType, 'RETURN_SHIPPING'>,
  leg: LegAccumulator,
): Promise<void> {
  if (!leg.gross.gt(0)) return;
  await upsertReturnEstimateFee(tx, {
    orderId,
    organizationId,
    feeType,
    direction: RETURN_LEG_DIRECTIONS[feeType],
    amountGross: leg.gross,
    vatRate: leg.vatRate,
    displayName: RETURN_LEG_DISPLAY_NAMES[feeType],
  });
}
