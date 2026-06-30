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
 * The recent, richly-structured tariffs for the list screen. Covers every list
 * status the UI must render — active / upcoming / past (×2) and a dateless draft
 * — plus both period shapes (a 3+4 split and single-period tariffs). The older
 * history is appended below so the list paginates. The list derives product
 * counts and stats from these; `exported` is tracked separately by the page (a
 * tariff becomes exported once it is saved & downloaded). Real templates come
 * from the uploaded Excel, parsed by the backend.
 */
const RECENT_TEMPLATES: readonly TariffTemplate[] = [
  {
    id: 'tpl-2330-haz',
    name: '23 – 30 Haziran 2026',
    sourceFilename: 'komisyon_tarifesi_2330_haz.xlsx',
    relativeLabel: 'Bu hafta',
    validity: 'active',
    updatedLabel: '2 gün önce',
    periods: [
      { id: 'p-2330-3day', dateRangeLabel: '23 Haz 08.00 – 26 Haz 07.59', rows: [r1, r2, r3] },
      { id: 'p-2330-4day', dateRangeLabel: '26 Haz 08.00 – 30 Haz 07.59', rows: [r1, r3, r4, r5] },
    ],
  },
  {
    id: 'tpl-3007-tem',
    name: '30 Haziran – 7 Temmuz 2026',
    sourceFilename: 'komisyon_tarifesi_3007_tem.xlsx',
    relativeLabel: 'Gelecek hafta',
    validity: 'upcoming',
    updatedLabel: '5 saat önce',
    periods: [
      {
        id: 'p-3007-week',
        dateRangeLabel: '30 Haz 08.00 – 7 Tem 07.59',
        rows: [r1, r2, r4, r5, r6],
      },
    ],
  },
  {
    id: 'tpl-1623-haz',
    name: '16 – 23 Haziran 2026',
    sourceFilename: 'komisyon_tarifesi_1623_haz.xlsx',
    relativeLabel: 'Geçen hafta',
    validity: 'past',
    updatedLabel: '1 hafta önce',
    periods: [
      { id: 'p-1623', dateRangeLabel: '16 Haz 08.00 – 23 Haz 07.59', rows: [r1, r2, r3, r4] },
    ],
  },
  {
    id: 'tpl-0916-haz',
    name: '9 – 16 Haziran 2026',
    sourceFilename: 'komisyon_tarifesi_0916_haz.xlsx',
    relativeLabel: '2 hafta önce',
    validity: 'past',
    updatedLabel: '2 hafta önce',
    periods: [{ id: 'p-0916', dateRangeLabel: '9 Haz 08.00 – 16 Haz 07.59', rows: [r2, r3, r5] }],
  },
  {
    id: 'tpl-taslak',
    name: 'Yeni tarife taslağı',
    sourceFilename: 'taslak.xlsx',
    relativeLabel: 'Tarih seçilmedi',
    validity: null,
    updatedLabel: '3 hafta önce',
    periods: [{ id: 'p-taslak', dateRangeLabel: 'Dönem belirlenmedi', rows: [r1, r6] }],
  },
];

/**
 * Older past tariffs — a season of prior weekly uploads — so the list paginates
 * and the stats read like a real, accumulated history. Compact specs mapped to
 * full templates; they reuse the product rows above and a single period each.
 */
interface PastTariffSpec {
  id: string;
  name: string;
  filename: string;
  relativeLabel: string;
  rows: readonly CommissionTariffRow[];
}

const OLDER_PAST_SPECS: readonly PastTariffSpec[] = [
  {
    id: 'tpl-0209-haz',
    name: '2 – 9 Haziran 2026',
    filename: 'komisyon_tarifesi_0209_haz.xlsx',
    relativeLabel: '3 hafta önce',
    rows: [r1, r2, r4, r5],
  },
  {
    id: 'tpl-2602-haz',
    name: '26 Mayıs – 2 Haziran 2026',
    filename: 'komisyon_tarifesi_2602_haz.xlsx',
    relativeLabel: '4 hafta önce',
    rows: [r2, r3, r6],
  },
  {
    id: 'tpl-1926-may',
    name: '19 – 26 Mayıs 2026',
    filename: 'komisyon_tarifesi_1926_may.xlsx',
    relativeLabel: '5 hafta önce',
    rows: [r1, r3, r5],
  },
  {
    id: 'tpl-1219-may',
    name: '12 – 19 Mayıs 2026',
    filename: 'komisyon_tarifesi_1219_may.xlsx',
    relativeLabel: '6 hafta önce',
    rows: [r1, r2, r3, r4, r5],
  },
  {
    id: 'tpl-0512-may',
    name: '5 – 12 Mayıs 2026',
    filename: 'komisyon_tarifesi_0512_may.xlsx',
    relativeLabel: '7 hafta önce',
    rows: [r4, r5, r6],
  },
  {
    id: 'tpl-2805-nis',
    name: '28 Nisan – 5 Mayıs 2026',
    filename: 'komisyon_tarifesi_2805_nis.xlsx',
    relativeLabel: '8 hafta önce',
    rows: [r1, r6],
  },
  {
    id: 'tpl-2128-nis',
    name: '21 – 28 Nisan 2026',
    filename: 'komisyon_tarifesi_2128_nis.xlsx',
    relativeLabel: '9 hafta önce',
    rows: [r2, r4],
  },
  {
    id: 'tpl-1421-nis',
    name: '14 – 21 Nisan 2026',
    filename: 'komisyon_tarifesi_1421_nis.xlsx',
    relativeLabel: '10 hafta önce',
    rows: [r1, r2, r3],
  },
];

const OLDER_PAST_TEMPLATES: readonly TariffTemplate[] = OLDER_PAST_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  sourceFilename: spec.filename,
  relativeLabel: spec.relativeLabel,
  validity: 'past',
  updatedLabel: spec.relativeLabel,
  periods: [{ id: `${spec.id}-p`, dateRangeLabel: spec.name, rows: spec.rows }],
}));

/**
 * Full saved-tariff list: the recent, structured tariffs first, then the older
 * weekly history. Ordered newest-first so the list's default order is sensible.
 */
export const MOCK_TARIFF_TEMPLATES: readonly TariffTemplate[] = [
  ...RECENT_TEMPLATES,
  ...OLDER_PAST_TEMPLATES,
];
