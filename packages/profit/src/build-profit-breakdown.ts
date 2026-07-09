/**
 * Kar dokumu gorunum modeli — GROSS konvansiyonu (Task 13).
 *
 * Gross items (lineSaleGross/commissionGross/unitCostSnapshotGross + vatRate'ler)
 * + fees (amountGross + vatRate, yon-imzali) → 2-ondalik string view + marjlar.
 *
 * netProfit / netVat / marginlar inputtan gelir (motor computeProfit tarafindan
 * zaten hesaplamis + persist edilmis); bu builder kalici gross terimlerden dokumu kurar
 * (kolon sisirmesi yok, "frontend'de hesap yok" korunur).
 *
 * KDV turevi: gross x rate/(100+rate) — gross otoriter, net/vat ayri kolon yok.
 *
 * Frontend ASLA turetmez (feedback_no_frontend_financial_calculation):
 * tek dogru kaynak burasi + computeProfit; UI yalniz render eder.
 */

import { Decimal } from 'decimal.js';

import type { OrderFeeSource, OrderFeeType } from '@pazarsync/db/enums';

import { resolveReturnLegs, type ReturnFeeRow } from './fold-return-legs';
import { grossToVat } from './money';

export interface ProfitBreakdownItemInput {
  quantity: number;
  lineListGross: Decimal | null;
  lineSaleGross: Decimal | null;
  lineSellerDiscountGross: Decimal | null;
  saleVatRate: number;
  commissionGross: Decimal;
  refundedCommissionGross: Decimal;
  commissionVatRate: number;
  unitCostSnapshotGross: Decimal | null;
  unitCostSnapshotVatRate: number;
}

export interface ProfitBreakdownFeeInput {
  feeType: OrderFeeType;
  direction: 'DEBIT' | 'CREDIT';
  amountGross: Decimal;
  vatRate: number;
  source: OrderFeeSource;
}

export interface BuildProfitBreakdownInput {
  saleGross: Decimal;
  saleVat: Decimal;
  listGross: Decimal;
  sellerDiscountGross: Decimal;
  items: ProfitBreakdownItemInput[];
  fees: ProfitBreakdownFeeInput[];
  netProfit: Decimal;
  netVat: Decimal;
  saleMarginPct: Decimal | null;
  costMarkupPct: Decimal | null;
}

/** Brut (KDV-dahil) terimler + Net KDV kirilimi — hepsi 2-ondalik string. */
export interface ProfitBreakdownView {
  listGross: string;
  sellerDiscountGross: string;
  saleGross: string;
  saleVat: string;
  costGross: string;
  costVat: string;
  commissionGross: string;
  commissionVat: string;
  shippingGross: string;
  shippingVat: string;
  /** Gidiş (forward SHIPPING) kargo brüt — "Toplam kargo" collapsible alt satırı. */
  outboundShippingGross: string;
  outboundShippingVat: string;
  /** İade (RETURN_SHIPPING) kargo brüt. '0.00' → iade kargosu yok (düz "Kargo" satırı). */
  returnShippingGross: string;
  returnShippingVat: string;
  platformServiceGross: string;
  platformServiceVat: string;
  // Mikro ihracat (Trendyol). Yalnız micro=true siparişlerde dolu; normal siparişte
  // '0.00' (frontend sıfır satırı gizler). Uluslararası Hizmet Bedeli PSF'nin yerini
  // alır (mikroda PSF muaf); Yurt Dışı İade Operasyon Bedeli iadede satış reverse
  // ETMEDEN tek DEBIT ücrettir (fold-return-legs çalışmaz). KDV'leri (varsa) Net KDV'ye
  // girer (computeProfit debitVat'a katar) → kartta da gösterilir ki Σ netVat'a kapansın.
  internationalServiceGross: string;
  internationalServiceVat: string;
  overseasReturnOperationGross: string;
  overseasReturnOperationVat: string;
  // Stopaj ayrı bir düşülen terim (komisyon/PSF içine katlanmaz). STOPPAGE fee'leri
  // (direction-signed) toplanır; vatRate 0 olduğu için Net KDV'ye GİRMEZ — netProfit'ten
  // doğrudan düşülür (computeProfit ile aynı cebir).
  stoppage: string;
  netVat: string;
  netProfit: string;
  saleMarginPct: string;
  costMarkupPct: string;
  // Kalem grupları (görünüm) — "satış nereye gitti" gruplu sunumu için grup
  // toplamları BURADA (kâr motorunda) toplanır; frontend finansal toplama yapmaz
  // (feedback_no_frontend_financial_calculation). Dört grup display satışa kapanır:
  // ürün maliyeti (costGross) + pazaryeri kesintileri + vergiler + net kâr = saleGross.
  // Pay (%) UI'da salt gösterim oranı olarak türetilir (formatPercentDisplay sınıfı).
  /** Pazaryeri kesintileri = komisyon + kargo + PSF + mikro ücretler (display, netted). */
  marketplaceFeesGross: string;
  /** Vergiler = stopaj + Net KDV. Net KDV negatifse (satıcı lehine) grup küçülür. */
  taxesGross: string;
  /** Toplam gider = ürün maliyeti + pazaryeri kesintileri + vergiler ( = satış − net kâr ). */
  totalDeductionsGross: string;
}

export function buildProfitBreakdown(input: BuildProfitBreakdownInput): ProfitBreakdownView {
  let costGross = new Decimal(0);
  let costVat = new Decimal(0);
  let commissionGross = new Decimal(0);
  let commissionVat = new Decimal(0);

  for (const item of input.items) {
    const qty = new Decimal(item.quantity);
    const unitCost = (item.unitCostSnapshotGross ?? new Decimal(0)).mul(qty);
    costGross = costGross.add(unitCost);
    costVat = costVat.add(grossToVat(unitCost, new Decimal(item.unitCostSnapshotVatRate)));

    const effComm = item.commissionGross.sub(item.refundedCommissionGross);
    commissionGross = commissionGross.add(effComm);
    commissionVat = commissionVat.add(grossToVat(effComm, new Decimal(item.commissionVatRate)));
  }

  // Fee aggregation: direction-signed (DEBIT subtracts in display, CREDIT adds back)
  const feeAgg = (type: OrderFeeType): { gross: Decimal; vat: Decimal } => {
    let gross = new Decimal(0);
    let vat = new Decimal(0);
    for (const fee of input.fees) {
      if (fee.feeType !== type) continue;
      const signed = fee.direction === 'DEBIT' ? fee.amountGross : fee.amountGross.neg();
      gross = gross.add(signed);
      vat = vat.add(
        grossToVat(signed.abs(), new Decimal(fee.vatRate)).mul(fee.direction === 'DEBIT' ? 1 : -1),
      );
    }
    return { gross, vat };
  };

  const shipping = feeAgg('SHIPPING');
  const platformService = feeAgg('PLATFORM_SERVICE');
  // Mikro ihracat ücretleri (Trendyol). Yön-imzalı toplanır; non-micro siparişte
  // ücret yok → '0.00'. OVERSEAS_RETURN_OPERATION RETURN_FEE_TYPES'ta DEĞİL (düz DEBIT,
  // return-leg değil) → resolveReturnLegs onu yok sayar, burada bir kez toplanır.
  const internationalService = feeAgg('INTERNATIONAL_SERVICE');
  const overseasReturnOperation = feeAgg('OVERSEAS_RETURN_OPERATION');
  // Stopaj: STOPPAGE fee'leri (vatRate 0). feeAgg yön-imzalı toplar; .gross alınır.
  const stoppage = feeAgg('STOPPAGE');

  // İade kalemleri: gercek varsa gercek (SETTLEMENT/CARGO_INVOICE), yoksa tahmin
  // tercih edilir. DB enum → union daraltması kastedilerek yapılır; fold-return-legs
  // ile aynı mantık (bkz. recompute-settled-profit.ts'deki as kullanımı).
  const RETURN_FEE_TYPES = new Set([
    'REFUND_DEDUCTION',
    'COMMISSION_REFUND',
    'COST_RETURN',
    'RETURN_SHIPPING',
    'STOPPAGE_REFUND',
  ] as const);
  const returnLegs = resolveReturnLegs(
    input.fees
      .filter((f) => RETURN_FEE_TYPES.has(f.feeType as ReturnFeeRow['feeType']))
      .map(
        (f): ReturnFeeRow => ({
          feeType: f.feeType as ReturnFeeRow['feeType'],
          // USER_OVERRIDE/MANUAL_ENTRY return fee'leri pratikte oluşmaz; yoksa
          // resolveReturnLegs hiçbir actual-source bulamadığı için zaten ESTIMATE'i
          // tercih eder — bu daraltma güvenlidir.
          source: f.source as ReturnFeeRow['source'],
          amountGross: f.amountGross,
          vatRate: new Decimal(f.vatRate),
        }),
      ),
  );

  // Gösterim netting: tam iade durumunda satış/maliyet/komisyon sıfıra iner,
  // kargo ilerisi + iadesi birleşir. netProfit/netVat motor değerleri değişmez.
  const dispSaleGross = input.saleGross.sub(returnLegs.REFUND_DEDUCTION.gross);
  const dispSaleVat = input.saleVat.sub(returnLegs.REFUND_DEDUCTION.vat);
  const dispCostGross = costGross.sub(returnLegs.COST_RETURN.gross);
  const dispCostVat = costVat.sub(returnLegs.COST_RETURN.vat);
  const dispCommissionGross = commissionGross.sub(returnLegs.COMMISSION_REFUND.gross);
  const dispCommissionVat = commissionVat.sub(returnLegs.COMMISSION_REFUND.vat);
  const dispShippingGross = shipping.gross.add(returnLegs.RETURN_SHIPPING.gross);
  const dispShippingVat = shipping.vat.add(returnLegs.RETURN_SHIPPING.vat);

  // Stopaj gösterimi: orijinal STOPPAGE − STOPPAGE_REFUND (fold-return-legs ile AYNI
  // cebir) → tam iade 0, kısmi orantılı. Açık STOPPAGE_REFUND bacağı sayesinde ekran
  // (Kâr dökümü) netProfit ile toplanır; ayrıca STOPPAGE_REFUND ücret zaman çizgisinde
  // "Stopaj iadesi" olarak görünür. Alt sınır 0 (over-refund negatif stopaj üretmesin).
  const dispStoppage = Decimal.max(0, stoppage.gross.sub(returnLegs.STOPPAGE_REFUND.gross));

  // Grup toplamları (görünüm) — display (netted) terimlerden toplanır ki gösterilen
  // dört grup display satışa kapansın. Pazaryeri = Trendyol'un kestiği tüm ücretler;
  // Vergiler = stopaj + Net KDV; Toplam gider = maliyet + pazaryeri + vergiler.
  const marketplaceFeesGross = dispCommissionGross
    .add(dispShippingGross)
    .add(platformService.gross)
    .add(internationalService.gross)
    .add(overseasReturnOperation.gross);
  const taxesGross = dispStoppage.add(input.netVat);
  const totalDeductionsGross = dispCostGross.add(marketplaceFeesGross).add(taxesGross);

  return {
    listGross: input.listGross.toFixed(2),
    sellerDiscountGross: input.sellerDiscountGross.toFixed(2),
    saleGross: dispSaleGross.toFixed(2),
    saleVat: dispSaleVat.toDecimalPlaces(2).toFixed(2),
    costGross: dispCostGross.toFixed(2),
    costVat: dispCostVat.toDecimalPlaces(2).toFixed(2),
    commissionGross: dispCommissionGross.toFixed(2),
    commissionVat: dispCommissionVat.toDecimalPlaces(2).toFixed(2),
    shippingGross: dispShippingGross.toFixed(2),
    shippingVat: dispShippingVat.toDecimalPlaces(2).toFixed(2),
    // Toplam (shipping*) KORUNUR; bileşenler ayrı: gidiş = forward SHIPPING feeAgg,
    // iade = RETURN_SHIPPING bacağı. outbound + return == shipping (invariant).
    outboundShippingGross: shipping.gross.toFixed(2),
    outboundShippingVat: shipping.vat.toDecimalPlaces(2).toFixed(2),
    returnShippingGross: returnLegs.RETURN_SHIPPING.gross.toFixed(2),
    returnShippingVat: returnLegs.RETURN_SHIPPING.vat.toDecimalPlaces(2).toFixed(2),
    platformServiceGross: platformService.gross.toFixed(2),
    platformServiceVat: platformService.vat.toDecimalPlaces(2).toFixed(2),
    internationalServiceGross: internationalService.gross.toFixed(2),
    internationalServiceVat: internationalService.vat.toDecimalPlaces(2).toFixed(2),
    overseasReturnOperationGross: overseasReturnOperation.gross.toFixed(2),
    overseasReturnOperationVat: overseasReturnOperation.vat.toDecimalPlaces(2).toFixed(2),
    stoppage: dispStoppage.toFixed(2),
    netVat: input.netVat.toFixed(2),
    netProfit: input.netProfit.toFixed(2),
    saleMarginPct: input.saleMarginPct === null ? '—' : input.saleMarginPct.toFixed(2),
    costMarkupPct: input.costMarkupPct === null ? '—' : input.costMarkupPct.toFixed(2),
    marketplaceFeesGross: marketplaceFeesGross.toFixed(2),
    taxesGross: taxesGross.toFixed(2),
    totalDeductionsGross: totalDeductionsGross.toFixed(2),
  };
}
