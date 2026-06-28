/**
 * "İade gelirse kâr" senaryosu — deterministik tam iade. OrderFee YAZMAZ; mevcut
 * iade-bacak matematiğini (foldReturnLegs) sentetik tam-iade bacaklarıyla bellekte
 * çalıştırır. Domestik: satış/komisyon/maliyet/stopaj sıfırlanır, barem'siz iade
 * kargosu eklenir, forward fee'ler (PSF/kargo) kalır. Mikro ihracat: satış reverse
 * YOK; tek DEBIT Yurt Dışı İade Operasyon Bedeli eklenir.
 */
import { Decimal } from 'decimal.js';

import type { Platform, Prisma } from '@pazarsync/db';

import { foldReturnLegs, type ResolvedReturnLegs } from './fold-return-legs';
import { grossToVat } from './money';
import {
  overseasReturnOperationGross,
  resolveOverseasReturnRate,
} from './overseas-return-operation';
import { computeProfit, type ProfitInput, type ProfitInputFee } from './profit-formula';
import { isMicroExport, resolveFeeDefinition } from './resolve-fee-definition';
import { estimateShippingCostForOrder } from './shipping/estimate-order-shipping';

export interface ReturnScenarioResult {
  netProfit: Decimal;
  saleMarginPct: Decimal | null;
}

export interface OrderForReturnScenario {
  id: string;
  orderDate: Date;
  micro: boolean;
  store: { platform: Platform };
  items: Array<{
    quantity: number;
    lineSaleGross: Decimal | string | null;
    commissionGross: Decimal | string;
    refundedCommissionGross: Decimal | string;
  }>;
}

/** Saf domestik tam-iade fold (DB'siz). İade kargosu (gross+vat) dışarıdan verilir. */
export function foldFullReturnDomestic(
  base: ProfitInput,
  returnShipping: { gross: Decimal; vat: Decimal },
): ReturnScenarioResult {
  const legs: ResolvedReturnLegs = {
    REFUND_DEDUCTION: { gross: base.sale.gross, vat: base.sale.vat },
    COMMISSION_REFUND: { gross: base.commission.gross, vat: base.commission.vat },
    COST_RETURN: { gross: base.cost.gross, vat: base.cost.vat },
    RETURN_SHIPPING: { gross: returnShipping.gross, vat: returnShipping.vat },
    STOPPAGE_REFUND: { gross: base.stoppage.gross, vat: new Decimal(0) },
  };
  const r = computeProfit(foldReturnLegs(base, legs));
  return { netProfit: r.netProfit, saleMarginPct: r.saleMarginPct };
}

/** Saf mikro tam-iade (DB'siz). Satış reverse YOK; overseas op bedeli DEBIT fee eklenir. */
export function computeMicroReturnScenario(
  base: ProfitInput,
  overseasFee: { gross: Decimal; vat: Decimal },
): ReturnScenarioResult {
  const fees: ProfitInputFee[] = [
    ...base.fees,
    {
      type: 'OVERSEAS_RETURN_OPERATION',
      gross: overseasFee.gross,
      vat: overseasFee.vat,
      direction: 'DEBIT',
    },
  ];
  const r = computeProfit({ ...base, fees });
  return { netProfit: r.netProfit, saleMarginPct: r.saleMarginPct };
}

export async function computeReturnScenario(
  base: ProfitInput,
  order: OrderForReturnScenario,
  tx: Prisma.TransactionClient,
): Promise<ReturnScenarioResult | null> {
  if (isMicroExport(order)) {
    // Mikro ihracat iade senaryosu: OVERSEAS_RETURN_OPERATION feeDefinitionId YOK ve
    // vat=0 — gerçek claim yolu (estimate-return-on-claim.ts) aynı şekilde sıfır VAT
    // ile yazar (canlı hakedişten doğrulanacak; data-driven → SQL güncellenir).
    // resolveFeeDefinition('OVERSEAS_RETURN_OPERATION') ÇAĞIRMA — DB'de FeeDefinition
    // satırı yok → throw. Gerçek yol vatRate=0 kullandığı için senaryo da aynısını yansıtır.
    let feeGross = new Decimal(0);
    for (const item of order.items) {
      if (item.lineSaleGross === null) continue;
      const lineSale = new Decimal(item.lineSaleGross);
      const qty = new Decimal(item.quantity);
      const unitSale = qty.isZero() ? lineSale : lineSale.div(qty);
      const rate = await resolveOverseasReturnRate(tx, unitSale, order.orderDate);
      const effComm = new Decimal(item.commissionGross).sub(
        new Decimal(item.refundedCommissionGross),
      );
      feeGross = feeGross.add(
        overseasReturnOperationGross([
          { acceptedSaleGross: lineSale, acceptedCommissionGross: effComm, rate },
        ]),
      );
    }
    return computeMicroReturnScenario(base, {
      gross: feeGross,
      vat: new Decimal(0), // KDV sıfır: gerçek claim yolunu yansıtır (vatRate=0 default)
    });
  }

  // Domestik: barem'siz iade kargosu tahmini.
  const shippingOutcome = await estimateShippingCostForOrder(order.id, tx, { applyBarem: false });
  let returnShip = { gross: new Decimal(0), vat: new Decimal(0) };
  if (shippingOutcome.ok) {
    const def = await resolveFeeDefinition(tx, {
      platform: order.store.platform,
      feeType: 'RETURN_SHIPPING',
      at: order.orderDate,
    });
    const vatRate = new Decimal(def.defaultVatRate);
    const gross = shippingOutcome.estimate.amount.mul(new Decimal(100).add(vatRate)).div(100);
    returnShip = { gross, vat: grossToVat(gross, vatRate) };
  }
  return foldFullReturnDomestic(base, returnShip);
}
