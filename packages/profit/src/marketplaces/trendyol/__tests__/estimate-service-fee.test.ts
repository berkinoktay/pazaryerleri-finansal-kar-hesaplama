import {
  FxRateSource,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeItem, makeParcel } from '../../../__tests__/fixtures/parcel-builders';
import { trendyolReference } from '../../../__tests__/fixtures/trendyol-reference';
import { estimateServiceFeeLine } from '../estimate-service-fee';
import { TRENDYOL_SAME_DAY_SHIPPING_TYPE } from '../trendyol-inputs';

const fees = trendyolReference().fees;

describe('estimateServiceFeeLine', () => {
  it('charges the standard fee', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });

    const line = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: false,
        fastDeliveryType: null,
        actualShipDate: null,
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });

    expect(line).not.toBeNull();
    expect(line?.type).toBe(ProfitLineType.SERVICE_FEE);
    expect(line?.level).toBe(ProfitLineLevel.PARCEL);
    expect(line?.orderItemId).toBeNull();
    expect(line?.amount.gross.toFixed(2)).toBe('13.19');
    expect(line?.amount.vat.toFixed(2)).toBe('2.20');
    expect(line?.vatRatePct?.toString()).toBe('20');
    expect(line?.certainty).toBe(ProfitLineCertainty.ESTIMATE);
    expect(line?.source).toBe(ProfitLineSource.RULE);
    expect(line?.fx.source).toBe(FxRateSource.NATIVE);
    expect(line?.inputs).toEqual({ tier: 'STANDARD', net: '10.99' });
  });

  it('charges the same-day fee when the ship date is unknown', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });

    const line = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: true,
        fastDeliveryType: TRENDYOL_SAME_DAY_SHIPPING_TYPE,
        actualShipDate: null,
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });

    expect(line?.amount.gross.toFixed(2)).toBe('8.39');
    expect(line?.amount.vat.toFixed(2)).toBe('1.40');
    expect(line?.inputs.tier).toBe('SAME_DAY');
  });

  it('decides same day on the Istanbul calendar', () => {
    const snapshot = makeParcel({
      orderDate: new Date('2026-10-28T09:00:00Z'),
      items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
    });

    const sameDay = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: true,
        fastDeliveryType: TRENDYOL_SAME_DAY_SHIPPING_TYPE,
        actualShipDate: new Date('2026-10-28T15:00:00Z'),
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });
    expect(sameDay?.amount.gross.toFixed(2)).toBe('8.39');
    expect(sameDay?.amount.vat.toFixed(2)).toBe('1.40');
    expect(sameDay?.inputs.tier).toBe('SAME_DAY');

    const nextDay = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: true,
        fastDeliveryType: TRENDYOL_SAME_DAY_SHIPPING_TYPE,
        actualShipDate: new Date('2026-10-28T22:30:00Z'),
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });
    expect(nextDay?.amount.gross.toFixed(2)).toBe('13.19');
    expect(nextDay?.amount.vat.toFixed(2)).toBe('2.20');
    expect(nextDay?.inputs.tier).toBe('STANDARD');
  });

  it('charges the standard fee when a same-day parcel ships on a later day', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });

    const line = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: true,
        fastDeliveryType: TRENDYOL_SAME_DAY_SHIPPING_TYPE,
        actualShipDate: new Date('2026-10-29T10:00:00Z'),
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });

    expect(line?.amount.gross.toFixed(2)).toBe('13.19');
    expect(line?.amount.vat.toFixed(2)).toBe('2.20');
    expect(line?.inputs.tier).toBe('STANDARD');
  });

  it('charges the standard fee for other fast delivery types', () => {
    const snapshot = makeParcel({ items: [makeItem({ orderItemId: 'a', listGross: '100.00' })] });

    const line = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: true,
        fastDeliveryType: 'FastDelivery',
        actualShipDate: null,
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });

    expect(line?.amount.gross.toFixed(2)).toBe('13.19');
    expect(line?.amount.vat.toFixed(2)).toBe('2.20');
    expect(line?.inputs.tier).toBe('STANDARD');
  });

  it('charges the fee when only some items are digital', () => {
    const snapshot = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', isDigital: true }),
        makeItem({ orderItemId: 'b', listGross: '50.00', isDigital: false }),
      ],
    });

    const line = estimateServiceFeeLine({
      snapshot,
      attributes: {
        fastDelivery: false,
        fastDeliveryType: null,
        actualShipDate: null,
        usesSellerCargoAgreement: false,
        items: [],
      },
      fees,
    });

    expect(line?.amount.gross.toFixed(2)).toBe('13.19');
    expect(line?.amount.vat.toFixed(2)).toBe('2.20');
    expect(line?.inputs.tier).toBe('STANDARD');
  });

  it('charges nothing for export, all-digital or all-cancelled parcels', () => {
    const baseAttributes = {
      fastDelivery: false,
      fastDeliveryType: null,
      actualShipDate: null,
      usesSellerCargoAgreement: false,
      items: [],
    } as const;

    const exportParcel = makeParcel({
      isExportSale: true,
      items: [makeItem({ orderItemId: 'a', listGross: '100.00' })],
    });
    expect(
      estimateServiceFeeLine({ snapshot: exportParcel, attributes: baseAttributes, fees }),
    ).toBeNull();

    const allDigital = makeParcel({
      items: [
        makeItem({ orderItemId: 'a', listGross: '100.00', isDigital: true }),
        makeItem({ orderItemId: 'b', listGross: '50.00', isDigital: true }),
      ],
    });
    expect(
      estimateServiceFeeLine({ snapshot: allDigital, attributes: baseAttributes, fees }),
    ).toBeNull();

    const allCancelled = makeParcel({
      items: [makeItem({ orderItemId: 'a', listGross: '100.00', isCancelled: true })],
    });
    expect(
      estimateServiceFeeLine({ snapshot: allCancelled, attributes: baseAttributes, fees }),
    ).toBeNull();
  });
});
