import { Decimal } from 'decimal.js';
import {
  BaremTier,
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ShippingTariffSource,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import {
  makeTrendyolAttributes,
  trendyolReference,
  twoTierBaremBands,
} from '../../../__tests__/fixtures/trendyol-reference';
import {
  CARRIER_NOT_RECOGNIZED_REASON,
  estimateShippingLine,
  resolveTrendyolShippingGross,
} from '../estimate-shipping';

describe('estimateShippingLine', () => {
  it('uses the desi tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '500.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    expect(line?.type).toBe(ProfitLineType.SHIPPING);
    expect(line?.level).toBe(ProfitLineLevel.PARCEL);
    expect(line?.orderItemId).toBeNull();
    expect(line?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(line?.source).toBe(ProfitLineSource.RULE);
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.amount.vat.toFixed(2)).toBe('18.73');
    expect(line?.vatRatePct?.toString()).toBe('20');
    expect(line?.inputs).toEqual({
      desi: '3',
      desiSource: 'PRODUCTS',
      basketGross: '500.00',
      tariffKind: 'DESI',
      carrierCode: 'TEXMP',
      baremTier: null,
      shipTiming: 'NOT_PROMISED',
    });
  });

  it('sums desi times quantity across items', () => {
    // Review focus 1: the parcel desi is the total, not the quantity-weighted average.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '300.00', unitDesi: '1', quantity: 2 }),
        makeItem({ orderItemId: 'b', listGross: '200.00', unitDesi: '3', quantity: 1 }),
      ],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    // Total desi 1x2 + 3x1 = 5 -> key '5' -> 108.90 net. An average (5/3 -> ceil 2) would give 93.05.
    expect(line?.amount.gross.toFixed(2)).toBe('130.68');
    expect(line?.amount.vat.toFixed(2)).toBe('21.78');
    expect(line?.inputs.desi).toBe('5');
    expect(line?.inputs.desiSource).toBe('PRODUCTS');
  });

  it('prefers the measured parcel desi and rounds desi up', () => {
    const snapshot = makeParcel({
      measuredDesi: '2.4',
      items: [makeItem({ orderItemId: 'a', listGross: '500.00', unitDesi: '1' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    // ceil(2.4) = 3 -> key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.inputs.desi).toBe('2.4');
    expect(line?.inputs.desiSource).toBe('MEASURED');
  });

  it('applies Barem for a fast-delivery basket in band', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    // Band [0, 199.99] -> 34.16 net -> 40.99 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('40.99');
    expect(line?.amount.vat.toFixed(2)).toBe('6.83');
    expect(line?.inputs.tariffKind).toBe('BAREM');
    expect(line?.inputs.carrierCode).toBe('TEXMP');
  });

  it('skips Barem above the band and falls back to the desi tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '350.00', unitDesi: '2' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    // Basket 350 is above every Barem band -> desi tariff key '2' -> 77.54 net -> 93.05 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('93.05');
    expect(line?.amount.vat.toFixed(2)).toBe('15.51');
    expect(line?.inputs.tariffKind).toBe('DESI');
  });

  it('reports DESI_OVERFLOW above the tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '11' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'DESI_OVERFLOW',
      },
    ]);
  });

  it('reports UNKNOWN_DESI when a product desi is missing', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: null })],
    });

    const { line, issues, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'UNKNOWN_DESI',
      },
    ]);
    expect(standaloneByItem.get('a')).toBeNull();
  });

  it('uses the own contract tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({
        shipping: {
          source: ShippingTariffSource.OWN_CONTRACT,
          ownTariffNet: new Map([['3', new Decimal('50.00')]]),
        },
      }),
    });

    expect(issues).toEqual([]);
    expect(line?.amount.gross.toFixed(2)).toBe('60.00');
    expect(line?.amount.vat.toFixed(2)).toBe('10.00');
    expect(line?.inputs.tariffKind).toBe('OWN');
    expect(line?.inputs.carrierCode).toBeNull();
  });

  it('computes standalone shipping per item for allocation', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '300.00', unitDesi: '1', quantity: 2 }),
        makeItem({ orderItemId: 'b', listGross: '200.00', unitDesi: '3', quantity: 1 }),
      ],
    });

    const { standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    // a: desi 1x2 = 2 -> key '2' -> 77.54 net -> 93.05 gross; b: desi 3 -> 93.63 net -> 112.36 gross.
    expect(standaloneByItem.get('a')?.toFixed(2)).toBe('93.05');
    expect(standaloneByItem.get('b')?.toFixed(2)).toBe('112.36');
  });

  it('reports NO_CARRIER without a carrier', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({ shipping: { carrier: null } }),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'NO_CARRIER',
      },
    ]);
  });

  it('writes a zero estimate for a not-recognized order carrier', () => {
    // An order whose Trendyol-contract carrier is not recognized gets a zero SHIPPING line
    // recording the reason + provider name, plus a non-blocking CARRIER_NOT_RECOGNIZED
    // issue -- NOT the NO_CARRIER unavailable issue a carrier-less scenario (outcome null)
    // produces.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({
        shipping: {
          carrier: null,
          orderCarrierOutcome: { kind: 'not-recognized', providerName: 'Alternative Delivery' },
        },
      }),
    });

    expect(issues).toEqual([
      {
        code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
        orderItemId: null,
        detail: 'Alternative Delivery',
      },
    ]);
    expect(line?.type).toBe(ProfitLineType.SHIPPING);
    expect(line?.level).toBe(ProfitLineLevel.PARCEL);
    expect(line?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(line?.amount.gross.toFixed(2)).toBe('0.00');
    expect(line?.amount.vat.toFixed(2)).toBe('0.00');
    expect(line?.inputs).toEqual({
      reason: CARRIER_NOT_RECOGNIZED_REASON,
      providerName: 'Alternative Delivery',
    });
  });

  it('records a null detail for a not-recognized carrier without a provider name', () => {
    // Trendyol named no provider at all: the zero line is still written and the issue
    // carries a null detail rather than an empty or made-up name.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({
        shipping: {
          carrier: null,
          orderCarrierOutcome: { kind: 'not-recognized', providerName: null },
        },
      }),
    });

    expect(issues).toEqual([
      { code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED, orderItemId: null, detail: null },
    ]);
    expect(line?.type).toBe(ProfitLineType.SHIPPING);
    expect(line?.amount.gross.toFixed(2)).toBe('0.00');
    expect(line?.inputs.reason).toBe(CARRIER_NOT_RECOGNIZED_REASON);
  });

  it('flags a seller-cargo-agreement order on a Trendyol-contract store', () => {
    // The seller ships under their own carrier contract, whose real price the engine
    // does not know: the line is still estimated from the Trendyol tariff, unchanged, and
    // a non-blocking SELLER_CARGO_AGREEMENT_ESTIMATE issue records why it stays an estimate.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '500.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false, usesSellerCargoAgreement: true }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
        orderItemId: null,
        detail: null,
      },
    ]);
    // Same amount as the plain desi tariff case: desi 3 -> 93.63 net -> 112.36 gross.
    expect(line?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(line?.source).toBe(ProfitLineSource.RULE);
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.amount.vat.toFixed(2)).toBe('18.73');
    expect(line?.inputs.tariffKind).toBe('DESI');
    expect(line?.inputs.carrierCode).toBe('TEXMP');
  });

  it('does not flag a seller-cargo-agreement order on an own-contract store', () => {
    // An own-contract store already prices shipping from the seller's own tariff, so the
    // estimate needs no warning.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false, usesSellerCargoAgreement: true }),
      reference: trendyolReference({
        shipping: {
          source: ShippingTariffSource.OWN_CONTRACT,
          ownTariffNet: new Map([['3', new Decimal('50.00')]]),
        },
      }),
    });

    expect(issues).toEqual([]);
    expect(line?.amount.gross.toFixed(2)).toBe('60.00');
    expect(line?.inputs.tariffKind).toBe('OWN');
  });

  it('returns both issues with a zero line for a not-recognized carrier on a seller-cargo order', () => {
    // A seller-cargo-agreement order whose carrier is not recognized keeps the zero line and
    // carries both non-blocking issues: the carrier one and the seller-cargo one.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false, usesSellerCargoAgreement: true }),
      reference: trendyolReference({
        shipping: {
          carrier: null,
          orderCarrierOutcome: { kind: 'not-recognized', providerName: 'Alternative Delivery' },
        },
      }),
    });

    expect(issues).toEqual([
      {
        code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
        orderItemId: null,
        detail: 'Alternative Delivery',
      },
      {
        code: ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
        orderItemId: null,
        detail: null,
      },
    ]);
    expect(line?.amount.gross.toFixed(2)).toBe('0.00');
    expect(line?.inputs.reason).toBe(CARRIER_NOT_RECOGNIZED_REASON);
  });

  it('adds no seller-cargo issue to an all-digital parcel on a Trendyol-contract store', () => {
    // An all-digital parcel ships nothing, so it returns before the seller-cargo issue is
    // attached: no line and no warning, even on a seller-cargo-agreement order.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', isDigital: true, unitDesi: null }),
        makeItem({ orderItemId: 'b', listGross: '50.00', isDigital: true, unitDesi: '2' }),
      ],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false, usesSellerCargoAgreement: true }),
      reference: trendyolReference({
        shipping: { source: ShippingTariffSource.TRENDYOL_CONTRACT },
      }),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([]);
  });

  it('adds the seller-cargo issue after the unknown-desi issue on a Trendyol-contract store', () => {
    // The seller-cargo issue rides along the unavailable outcome, after that outcome's own
    // issue.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: null })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false, usesSellerCargoAgreement: true }),
      reference: trendyolReference({
        shipping: { source: ShippingTariffSource.TRENDYOL_CONTRACT },
      }),
    });

    expect(line).toBeNull();
    expect(issues.map((issue) => issue.code)).toEqual([
      ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
    ]);
    expect(issues[0]?.detail).toBe('UNKNOWN_DESI');
  });

  it('reports OWN_CONTRACT_EMPTY when the own tariff has no row', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({ shipping: { source: ShippingTariffSource.OWN_CONTRACT } }),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([
      {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'OWN_CONTRACT_EMPTY',
      },
    ]);
  });

  it('uses the unrounded desi for the Barem limit', () => {
    const snapshot = makeParcel({
      measuredDesi: '2.4',
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '1' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference({
        shipping: {
          carrier: {
            code: 'TEXMP',
            supportsBarem: true,
            maxBaremDesi: new Decimal('2.5'),
            baremAppliesToReturns: false,
          },
        },
      }),
    });

    expect(issues).toEqual([]);
    // 2.4 <= 2.5 keeps Barem even though ceil(2.4) = 3 would overflow the limit if rounded.
    expect(line?.amount.gross.toFixed(2)).toBe('40.99');
    expect(line?.inputs.tariffKind).toBe('BAREM');
    expect(line?.inputs.desi).toBe('2.4');
  });

  it('skips Barem above the carrier desi limit', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '3' })],
    });

    const { line, issues } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference({
        shipping: {
          carrier: {
            code: 'TEXMP',
            supportsBarem: true,
            maxBaremDesi: new Decimal('2'),
            baremAppliesToReturns: false,
          },
        },
      }),
    });

    expect(issues).toEqual([]);
    // desi 3 > maxBaremDesi 2 -> no Barem -> desi tariff key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.inputs.tariffKind).toBe('DESI');
  });

  it('estimates nothing when every item is cancelled', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3', isCancelled: true }),
        makeItem({ orderItemId: 'b', listGross: '50.00', unitDesi: '1', isCancelled: true }),
      ],
    });

    const { line, issues, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([]);
    expect(standaloneByItem.size).toBe(0);
  });

  it('estimates no shipping for an all-digital parcel', () => {
    // Plan decision 11b: digital items do not ship, like the service-fee exemption.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', isDigital: true, unitDesi: null }),
        makeItem({ orderItemId: 'b', listGross: '50.00', isDigital: true, unitDesi: '2' }),
      ],
    });

    const { line, issues, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issues).toEqual([]);
    expect(standaloneByItem.get('a')?.toFixed(2)).toBe('0.00');
    expect(standaloneByItem.get('b')?.toFixed(2)).toBe('0.00');
  });

  it('leaves digital items out of the parcel desi', () => {
    // Plan decision 11b: a digital item does not add to the desi, and its unknown
    // desi does not block the estimate; its standalone shipping is zero.
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '500.00', unitDesi: '3' }),
        makeItem({ orderItemId: 'b', listGross: '100.00', isDigital: true, unitDesi: null }),
      ],
    });

    const { line, issues, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issues).toEqual([]);
    // Only item a counts: desi 3 -> key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.amount.vat.toFixed(2)).toBe('18.73');
    expect(line?.inputs.desi).toBe('3');
    expect(line?.inputs.desiSource).toBe('PRODUCTS');
    expect(standaloneByItem.get('b')?.toFixed(2)).toBe('0.00');
  });
});

describe('estimateShippingLine Barem tables', () => {
  // Trendyol's ship-by deadline: Istanbul 23:59 of the promised day (20:59 UTC).
  const AGREED = new Date('2026-09-10T20:59:00.000Z');
  const SHIPPED_ON_TIME = new Date('2026-09-10T09:15:00.000Z');
  const SHIPPED_LATE = new Date('2026-09-11T08:00:00.000Z');

  function twoTierReference(maxBaremDesi = '10') {
    return trendyolReference({
      shipping: {
        carrier: {
          code: 'TEXMP',
          supportsBarem: true,
          maxBaremDesi: new Decimal(maxBaremDesi),
          baremAppliesToReturns: true,
        },
        baremBands: twoTierBaremBands(),
      },
    });
  }

  it('prices an on-time fast-delivery order at table 1 on a two-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line, issues, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_ON_TIME,
      }),
      reference: twoTierReference(),
    });

    expect(issues).toEqual([]);
    // Table 1 band [0, 199.99] -> 38.74 net -> 46.49 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('46.49');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'BAREM',
      baremTier: BaremTier.TABLE_1,
      shipTiming: 'ON_TIME',
    });
    expect(outboundBaremTier).toBe(BaremTier.TABLE_1);
  });

  it('prices a late fast-delivery order at table 2 on a two-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '250.00', unitDesi: '2' })],
    });

    const { line, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_LATE,
      }),
      reference: twoTierReference(),
    });

    // Table 2 band [200, 349.99] -> 78.74 net -> 94.49 gross (the late TEX invoices).
    expect(line?.amount.gross.toFixed(2)).toBe('94.49');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'BAREM',
      baremTier: BaremTier.TABLE_2,
      shipTiming: 'LATE',
    });
    expect(outboundBaremTier).toBe(BaremTier.TABLE_2);
  });

  it('prices an order without a fast-delivery promise at table 2 on a two-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: twoTierReference(),
    });

    // Table 2 band [0, 199.99] -> 73.33 net -> 88.00 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('88.00');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'BAREM',
      baremTier: BaremTier.TABLE_2,
      shipTiming: 'NOT_PROMISED',
    });
  });

  it('prices a promised order not yet shipped at table 1 on a two-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '250.00', unitDesi: '2' })],
    });

    const { line } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: null,
      }),
      reference: twoTierReference(),
    });

    // Table 1 band [200, 349.99] -> 70.41 net -> 84.49 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('84.49');
    expect(line?.inputs).toMatchObject({ baremTier: BaremTier.TABLE_1, shipTiming: 'NOT_SHIPPED' });
  });

  it('falls back to the desi tariff when the basket is in no band of table 2', () => {
    // A two-tier version whose table 2 covers only [0, 199.99]: a late order with a 250
    // basket finds no table 2 band, so it pays the desi tariff, not table 1.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '250.00', unitDesi: '2' })],
    });
    const baremBands = twoTierBaremBands().filter(
      (band) => band.tier === BaremTier.TABLE_1 || band.minOrderAmount.isZero(),
    );

    const { line, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_LATE,
      }),
      reference: trendyolReference({ shipping: { baremBands } }),
    });

    // Desi tariff key '2' -> 77.54 net -> 93.05 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('93.05');
    expect(line?.inputs).toMatchObject({ tariffKind: 'DESI', baremTier: null, shipTiming: 'LATE' });
    expect(outboundBaremTier).toBeNull();
  });

  it('keeps table 1 for a late fast-delivery order on a single-tier version', () => {
    // A version before 10 August 2026 has no table 2: the old rule (the promise alone)
    // keeps the order's figure unchanged; the late ship timing is still recorded.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_LATE,
      }),
      reference: trendyolReference(),
    });

    // Single-tier band [0, 199.99] -> 34.16 net -> 40.99 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('40.99');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'BAREM',
      baremTier: BaremTier.TABLE_1,
      shipTiming: 'LATE',
    });
    expect(outboundBaremTier).toBe(BaremTier.TABLE_1);
  });

  it('uses the desi tariff for an order without a promise on a single-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    // Desi tariff key '2' -> 77.54 net -> 93.05 gross, as before the two-table rule.
    expect(line?.amount.gross.toFixed(2)).toBe('93.05');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'DESI',
      baremTier: null,
      shipTiming: 'NOT_PROMISED',
    });
    expect(outboundBaremTier).toBeNull();
  });

  it('uses the desi tariff above the Barem desi limit on a two-tier version', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '3' })],
    });

    const { line, outboundBaremTier } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_ON_TIME,
      }),
      reference: twoTierReference('2'),
    });

    // desi 3 > maxBaremDesi 2 -> desi tariff key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.inputs).toMatchObject({
      tariffKind: 'DESI',
      baremTier: null,
      shipTiming: 'ON_TIME',
    });
    expect(outboundBaremTier).toBeNull();
  });

  it('prices the standalone amounts at the parcel table', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '1' }),
        makeItem({ orderItemId: 'b', listGross: '80.00', unitDesi: '1' }),
      ],
    });

    const { line, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({
        fastDelivery: true,
        agreedDeliveryDate: AGREED,
        actualShipDate: SHIPPED_LATE,
      }),
      reference: twoTierReference(),
    });

    // Parcel basket 230 -> table 2 band [200, 349.99] -> 94.49 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('94.49');
    // Each item alone is in table 2 band [0, 199.99] -> 73.33 net -> 88.00 gross.
    expect(standaloneByItem.get('a')?.toFixed(2)).toBe('88.00');
    expect(standaloneByItem.get('b')?.toFixed(2)).toBe('88.00');
  });
});

describe('resolveTrendyolShippingGross', () => {
  it('resolves a gross amount from the net tariff', () => {
    const tariff = trendyolReference().shipping;

    const resolved = resolveTrendyolShippingGross({
      desi: new Decimal('3'),
      basketGross: new Decimal('500.00'),
      baremTier: null,
      tariff,
      vatRatePct: new Decimal('20'),
    });
    // desi 3 -> key '3' -> 93.63 net -> grossFromNet(20) -> 112.36.
    expect(resolved).toEqual({ ok: true, gross: new Decimal('112.36'), kind: 'DESI' });

    const overflow = resolveTrendyolShippingGross({
      desi: new Decimal('11'),
      basketGross: new Decimal('500.00'),
      baremTier: null,
      tariff,
      vatRatePct: new Decimal('20'),
    });
    expect(overflow).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
  });
});
