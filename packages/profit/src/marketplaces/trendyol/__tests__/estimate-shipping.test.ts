import { Decimal } from 'decimal.js';
import {
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

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
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

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
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

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
    // ceil(2.4) = 3 -> key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.inputs.desi).toBe('2.4');
    expect(line?.inputs.desiSource).toBe('MEASURED');
  });

  it('applies Barem for a fast-delivery basket in band', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '2' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
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

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
    // Basket 350 is above every Barem band -> desi tariff key '2' -> 77.54 net -> 93.05 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('93.05');
    expect(line?.amount.vat.toFixed(2)).toBe('15.51');
    expect(line?.inputs.tariffKind).toBe('DESI');
  });

  it('reports DESI_OVERFLOW above the tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '11' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issue).toEqual({
      code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      orderItemId: null,
      detail: 'DESI_OVERFLOW',
    });
  });

  it('reports UNKNOWN_DESI when a product desi is missing', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: null })],
    });

    const { line, issue, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issue).toEqual({
      code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      orderItemId: null,
      detail: 'UNKNOWN_DESI',
    });
    expect(standaloneByItem.get('a')).toBeNull();
  });

  it('uses the own contract tariff', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({
        shipping: {
          source: ShippingTariffSource.OWN_CONTRACT,
          ownTariffNet: new Map([['3', new Decimal('50.00')]]),
        },
      }),
    });

    expect(issue).toBeNull();
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

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({ shipping: { carrier: null } }),
    });

    expect(line).toBeNull();
    expect(issue).toEqual({
      code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      orderItemId: null,
      detail: 'NO_CARRIER',
    });
  });

  it('writes a zero estimate for a not-recognized order carrier', () => {
    // An order whose Trendyol-contract carrier is not recognized gets a zero SHIPPING line
    // recording the reason + provider name -- NOT the NO_CARRIER unavailable issue a
    // carrier-less scenario (outcome null) produces.
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({
        shipping: {
          carrier: null,
          orderCarrierOutcome: { kind: 'not-recognized', providerName: 'Alternative Delivery' },
        },
      }),
    });

    expect(issue).toBeNull();
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

  it('reports OWN_CONTRACT_EMPTY when the own tariff has no row', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', unitDesi: '3' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference({ shipping: { source: ShippingTariffSource.OWN_CONTRACT } }),
    });

    expect(line).toBeNull();
    expect(issue).toEqual({
      code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      orderItemId: null,
      detail: 'OWN_CONTRACT_EMPTY',
    });
  });

  it('uses the unrounded desi for the Barem limit', () => {
    const snapshot = makeParcel({
      measuredDesi: '2.4',
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '1' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference({
        shipping: {
          carrier: { code: 'TEXMP', supportsBarem: true, maxBaremDesi: new Decimal('2.5') },
        },
      }),
    });

    expect(issue).toBeNull();
    // 2.4 <= 2.5 keeps Barem even though ceil(2.4) = 3 would overflow the limit if rounded.
    expect(line?.amount.gross.toFixed(2)).toBe('40.99');
    expect(line?.inputs.tariffKind).toBe('BAREM');
    expect(line?.inputs.desi).toBe('2.4');
  });

  it('skips Barem above the carrier desi limit', () => {
    const snapshot = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '150.00', unitDesi: '3' })],
    });

    const { line, issue } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: true }),
      reference: trendyolReference({
        shipping: {
          carrier: { code: 'TEXMP', supportsBarem: true, maxBaremDesi: new Decimal('2') },
        },
      }),
    });

    expect(issue).toBeNull();
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

    const { line, issue, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issue).toBeNull();
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

    const { line, issue, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(line).toBeNull();
    expect(issue).toBeNull();
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

    const { line, issue, standaloneByItem } = estimateShippingLine({
      snapshot,
      attributes: makeTrendyolAttributes({ fastDelivery: false }),
      reference: trendyolReference(),
    });

    expect(issue).toBeNull();
    // Only item a counts: desi 3 -> key '3' -> 93.63 net -> 112.36 gross.
    expect(line?.amount.gross.toFixed(2)).toBe('112.36');
    expect(line?.amount.vat.toFixed(2)).toBe('18.73');
    expect(line?.inputs.desi).toBe('3');
    expect(line?.inputs.desiSource).toBe('PRODUCTS');
    expect(standaloneByItem.get('b')?.toFixed(2)).toBe('0.00');
  });
});

describe('resolveTrendyolShippingGross', () => {
  it('resolves a gross amount from the net tariff', () => {
    const tariff = trendyolReference().shipping;

    const resolved = resolveTrendyolShippingGross({
      desi: new Decimal('3'),
      basketGross: new Decimal('500.00'),
      eligibleForBarem: false,
      tariff,
      vatRatePct: new Decimal('20'),
    });
    // desi 3 -> key '3' -> 93.63 net -> grossFromNet(20) -> 112.36.
    expect(resolved).toEqual({ ok: true, gross: new Decimal('112.36'), kind: 'DESI' });

    const overflow = resolveTrendyolShippingGross({
      desi: new Decimal('11'),
      basketGross: new Decimal('500.00'),
      eligibleForBarem: false,
      tariff,
      vatRatePct: new Decimal('20'),
    });
    expect(overflow).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
  });
});
