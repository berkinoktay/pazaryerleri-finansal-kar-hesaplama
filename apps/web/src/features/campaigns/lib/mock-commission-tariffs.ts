import { Decimal } from 'decimal.js';

import type { BandKey, CommissionTariffRow, PriceBand, TariffTemplate } from '../types';

/**
 * UI-only mock data for the Product Commission Tariffs page. SSR-safe (built
 * from constant strings at module scope — no Date.now / Math.random). Profit is
 * DERIVED from a single per-product unit cost + each band's commission, so the
 * figures are internally consistent and the custom-price estimator (same
 * formula) lines up with the band cells. The real values come from the backend
 * profit engine; this only stands in for the UI.
 *
 * Band semantics: band1 is the "ve üzeri" range the product is currently in →
 * profit at the current price. Bands 2–4 are "ve altı" discount ranges → profit
 * at that range's max price (its threshold).
 */

interface BandSpec {
  key: BandKey;
  label: string;
  threshold: string;
  commission: string;
}

interface RowMeta {
  id: string;
  productTitle: string;
  category: string;
  brand: string;
  modelCode: string;
  barcode: string;
  stock: number;
}

function buildBand(spec: BandSpec, priceForProfit: Decimal, unitCost: Decimal): PriceBand {
  const threshold = new Decimal(spec.threshold);
  const commissionPct = new Decimal(spec.commission);
  const profit = priceForProfit.minus(priceForProfit.times(commissionPct)).minus(unitCost);
  const marginPct = profit.dividedBy(priceForProfit).times(100).toFixed(2);
  return { key: spec.key, thresholdLabel: spec.label, threshold, commissionPct, profit, marginPct };
}

function makeRow(
  meta: RowMeta,
  currentPriceStr: string,
  unitCostStr: string,
  specs: readonly [BandSpec, BandSpec, BandSpec, BandSpec],
): CommissionTariffRow {
  const currentPrice = new Decimal(currentPriceStr);
  const unitCost = new Decimal(unitCostStr);
  const b1 = buildBand(specs[0], currentPrice, unitCost);
  const b2 = buildBand(specs[1], new Decimal(specs[1].threshold), unitCost);
  const b3 = buildBand(specs[2], new Decimal(specs[2].threshold), unitCost);
  const b4 = buildBand(specs[3], new Decimal(specs[3].threshold), unitCost);
  let best: PriceBand = b1;
  for (const band of [b2, b3, b4]) {
    if (band.profit.greaterThan(best.profit)) best = band;
  }
  return {
    ...meta,
    currentPrice,
    displayPrice: currentPrice,
    currentCommissionPct: b1.commissionPct,
    unitCost,
    bands: [b1, b2, b3, b4],
    bestBand: best.key,
  };
}

const r1 = makeRow(
  {
    id: 'r1',
    productTitle: '200x300 cm Kumaş Türk Bayrağı',
    category: 'Bayrak & Flama',
    brand: 'Vatan Bayrak',
    modelCode: 'TB-200300',
    barcode: '8690000000201',
    stock: 875,
  },
  '779.90',
  '605',
  [
    { key: 'band1', label: '777,10₺ ve üzeri', threshold: '777.10', commission: '0.19' },
    { key: 'band2', label: '777,09₺ ve altı', threshold: '777.09', commission: '0.131' },
    { key: 'band3', label: '753,23₺ ve altı', threshold: '753.23', commission: '0.121' },
    { key: 'band4', label: '720,77₺ ve altı', threshold: '720.77', commission: '0.106' },
  ],
);

const r2 = makeRow(
  {
    id: 'r2',
    productTitle: '100x150 cm Kumaş Türk Bayrağı',
    category: 'Bayrak & Flama',
    brand: 'Vatan Bayrak',
    modelCode: 'TB-100150',
    barcode: '8690000000102',
    stock: 1240,
  },
  '264.90',
  '195',
  [
    { key: 'band1', label: '259,90₺ ve üzeri', threshold: '259.90', commission: '0.205' },
    { key: 'band2', label: '259,89₺ ve altı', threshold: '259.89', commission: '0.145' },
    { key: 'band3', label: '244,90₺ ve altı', threshold: '244.90', commission: '0.128' },
    { key: 'band4', label: '229,90₺ ve altı', threshold: '229.90', commission: '0.112' },
  ],
);

const r3 = makeRow(
  {
    id: 'r3',
    productTitle: '70x105 cm Raşel Türk Bayrağı',
    category: 'Bayrak & Flama',
    brand: 'Şanlı Bayrak',
    modelCode: 'TB-RS-70105',
    barcode: '8690000000073',
    stock: 38,
  },
  '92.90',
  '72',
  [
    { key: 'band1', label: '89,90₺ ve üzeri', threshold: '89.90', commission: '0.22' },
    { key: 'band2', label: '89,89₺ ve altı', threshold: '89.89', commission: '0.16' },
    { key: 'band3', label: '84,90₺ ve altı', threshold: '84.90', commission: '0.14' },
    { key: 'band4', label: '79,90₺ ve altı', threshold: '79.90', commission: '0.118' },
  ],
);

const r4 = makeRow(
  {
    id: 'r4',
    productTitle: 'Direk Üstü Makam Bayrağı 100x150',
    category: 'Makam & Tören',
    brand: 'Vatan Bayrak',
    modelCode: 'MK-100150',
    barcode: '8690000000409',
    stock: 312,
  },
  '294.90',
  '235',
  [
    { key: 'band1', label: '289,90₺ ve üzeri', threshold: '289.90', commission: '0.19' },
    { key: 'band2', label: '289,89₺ ve altı', threshold: '289.89', commission: '0.142' },
    { key: 'band3', label: '274,90₺ ve altı', threshold: '274.90', commission: '0.126' },
    { key: 'band4', label: '259,90₺ ve altı', threshold: '259.90', commission: '0.109' },
  ],
);

const r5 = makeRow(
  {
    id: 'r5',
    productTitle: 'Gönder Bayrağı 80x120 Alpaka',
    category: 'Bayrak & Flama',
    brand: 'Şanlı Bayrak',
    modelCode: 'GB-80120',
    barcode: '8690000000515',
    stock: 526,
  },
  '139.90',
  '105',
  [
    { key: 'band1', label: '134,90₺ ve üzeri', threshold: '134.90', commission: '0.21' },
    { key: 'band2', label: '134,89₺ ve altı', threshold: '134.89', commission: '0.15' },
    { key: 'band3', label: '127,90₺ ve altı', threshold: '127.90', commission: '0.133' },
    { key: 'band4', label: '119,90₺ ve altı', threshold: '119.90', commission: '0.115' },
  ],
);

const r6 = makeRow(
  {
    id: 'r6',
    productTitle: 'Atatürk Posteri 70x100 Çift Taraflı',
    category: 'Poster & Afiş',
    brand: 'Vatan Bayrak',
    modelCode: 'AP-70100',
    barcode: '8690000000628',
    stock: 91,
  },
  '74.90',
  '58',
  [
    { key: 'band1', label: '72,90₺ ve üzeri', threshold: '72.90', commission: '0.225' },
    { key: 'band2', label: '72,89₺ ve altı', threshold: '72.89', commission: '0.165' },
    { key: 'band3', label: '68,90₺ ve altı', threshold: '68.90', commission: '0.144' },
    { key: 'band4', label: '64,90₺ ve altı', threshold: '64.90', commission: '0.12' },
  ],
);

/**
 * Pool of mock tariff templates an upload can "create". Successive uploads pull
 * the next one (the first is a 3+4 split tariff, the second a single-period one)
 * so both period shapes are demonstrable. Real templates come from the uploaded
 * Excel, parsed by the backend.
 */
export const MOCK_TARIFF_TEMPLATES: readonly TariffTemplate[] = [
  {
    id: 'tpl-2026-06-23',
    name: '23–30 Haziran',
    validity: 'active',
    updatedLabel: '2 gün önce',
    periods: [
      { id: 'p-3day', dateRangeLabel: '23 Haz 08.00 – 26 Haz 07.59', rows: [r1, r2, r3] },
      { id: 'p-4day', dateRangeLabel: '26 Haz 08.00 – 30 Haz 07.59', rows: [r1, r3, r4, r5] },
    ],
  },
  {
    id: 'tpl-2026-06-30',
    name: '30 Haziran – 7 Temmuz',
    validity: 'upcoming',
    updatedLabel: '5 saat önce',
    periods: [
      { id: 'p-week', dateRangeLabel: '30 Haz 08.00 – 7 Tem 07.59', rows: [r1, r2, r4, r5, r6] },
    ],
  },
];
