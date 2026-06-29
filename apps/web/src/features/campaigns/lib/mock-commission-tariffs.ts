import { Decimal } from 'decimal.js';

import type { CommissionTariffRow, TariffWeek } from '../types';

/**
 * UI-only mock data for the Product Commission Tariffs page. SSR-safe:
 * everything is built from constant strings at module scope (no Date.now /
 * Math.random). The real page will get this from the backend, which parses the
 * uploaded Trendyol tariff Excel through @pazarsync/spreadsheet. The period
 * structure (count + labels) is data-driven on purpose — see types.ts.
 */

const r1: CommissionTariffRow = {
  id: 'r1',
  productTitle: '200x300 cm Kumaş Türk Bayrağı',
  category: 'Bayrak & Flama',
  brand: 'Vatan Bayrak',
  modelCode: 'TB-200300',
  barcode: '8690000000201',
  stock: 875,
  currentPrice: new Decimal('852.00'),
  currentCommissionPct: new Decimal('0.19'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '777,10₺ ve üzeri',
      commissionPct: new Decimal('0.19'),
      profit: new Decimal('30.40'),
      marginPct: '3.57',
    },
    {
      key: 'band2',
      thresholdLabel: '777,09₺ ve altı',
      commissionPct: new Decimal('0.131'),
      profit: new Decimal('70.79'),
      marginPct: '9.11',
    },
    {
      key: 'band3',
      thresholdLabel: '753,23₺ ve altı',
      commissionPct: new Decimal('0.121'),
      profit: new Decimal('58.11'),
      marginPct: '7.71',
    },
    {
      key: 'band4',
      thresholdLabel: '720,77₺ ve altı',
      commissionPct: new Decimal('0.106'),
      profit: new Decimal('44.00'),
      marginPct: '6.10',
    },
  ],
  bestBand: 'band2',
};

const r2: CommissionTariffRow = {
  id: 'r2',
  productTitle: '100x150 cm Kumaş Türk Bayrağı',
  category: 'Bayrak & Flama',
  brand: 'Vatan Bayrak',
  modelCode: 'TB-100150',
  barcode: '8690000000102',
  stock: 1240,
  currentPrice: new Decimal('284.90'),
  currentCommissionPct: new Decimal('0.205'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '259,90₺ ve üzeri',
      commissionPct: new Decimal('0.205'),
      profit: new Decimal('18.20'),
      marginPct: '6.39',
    },
    {
      key: 'band2',
      thresholdLabel: '259,89₺ ve altı',
      commissionPct: new Decimal('0.145'),
      profit: new Decimal('33.55'),
      marginPct: '12.91',
    },
    {
      key: 'band3',
      thresholdLabel: '244,90₺ ve altı',
      commissionPct: new Decimal('0.128'),
      profit: new Decimal('28.10'),
      marginPct: '11.47',
    },
    {
      key: 'band4',
      thresholdLabel: '229,90₺ ve altı',
      commissionPct: new Decimal('0.112'),
      profit: new Decimal('21.40'),
      marginPct: '9.31',
    },
  ],
  bestBand: 'band2',
};

const r3: CommissionTariffRow = {
  id: 'r3',
  productTitle: '70x105 cm Raşel Türk Bayrağı',
  category: 'Bayrak & Flama',
  brand: 'Şanlı Bayrak',
  modelCode: 'TB-RS-70105',
  barcode: '8690000000073',
  stock: 38,
  currentPrice: new Decimal('96.50'),
  currentCommissionPct: new Decimal('0.22'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '89,90₺ ve üzeri',
      commissionPct: new Decimal('0.22'),
      profit: new Decimal('-4.80'),
      marginPct: '-4.97',
    },
    {
      key: 'band2',
      thresholdLabel: '89,89₺ ve altı',
      commissionPct: new Decimal('0.16'),
      profit: new Decimal('6.10'),
      marginPct: '6.32',
    },
    {
      key: 'band3',
      thresholdLabel: '84,90₺ ve altı',
      commissionPct: new Decimal('0.14'),
      profit: new Decimal('4.35'),
      marginPct: '4.85',
    },
    {
      key: 'band4',
      thresholdLabel: '79,90₺ ve altı',
      commissionPct: new Decimal('0.118'),
      profit: new Decimal('1.90'),
      marginPct: '2.27',
    },
  ],
  bestBand: 'band2',
};

const r4: CommissionTariffRow = {
  id: 'r4',
  productTitle: 'Direk Üstü Makam Bayrağı 100x150',
  category: 'Makam & Tören',
  brand: 'Vatan Bayrak',
  modelCode: 'MK-100150',
  barcode: '8690000000409',
  stock: 312,
  currentPrice: new Decimal('309.90'),
  currentCommissionPct: new Decimal('0.19'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '289,90₺ ve üzeri',
      commissionPct: new Decimal('0.19'),
      profit: new Decimal('41.10'),
      marginPct: '13.26',
    },
    {
      key: 'band2',
      thresholdLabel: '289,89₺ ve altı',
      commissionPct: new Decimal('0.142'),
      profit: new Decimal('52.30'),
      marginPct: '18.04',
    },
    {
      key: 'band3',
      thresholdLabel: '274,90₺ ve altı',
      commissionPct: new Decimal('0.126'),
      profit: new Decimal('46.80'),
      marginPct: '17.02',
    },
    {
      key: 'band4',
      thresholdLabel: '259,90₺ ve altı',
      commissionPct: new Decimal('0.109'),
      profit: new Decimal('38.20'),
      marginPct: '14.70',
    },
  ],
  bestBand: 'band2',
};

const r5: CommissionTariffRow = {
  id: 'r5',
  productTitle: 'Gönder Bayrağı 80x120 Alpaka',
  category: 'Bayrak & Flama',
  brand: 'Şanlı Bayrak',
  modelCode: 'GB-80120',
  barcode: '8690000000515',
  stock: 526,
  currentPrice: new Decimal('145.00'),
  currentCommissionPct: new Decimal('0.21'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '134,90₺ ve üzeri',
      commissionPct: new Decimal('0.21'),
      profit: new Decimal('9.70'),
      marginPct: '6.69',
    },
    {
      key: 'band2',
      thresholdLabel: '134,89₺ ve altı',
      commissionPct: new Decimal('0.15'),
      profit: new Decimal('18.40'),
      marginPct: '13.64',
    },
    {
      key: 'band3',
      thresholdLabel: '127,90₺ ve altı',
      commissionPct: new Decimal('0.133'),
      profit: new Decimal('15.20'),
      marginPct: '11.88',
    },
    {
      key: 'band4',
      thresholdLabel: '119,90₺ ve altı',
      commissionPct: new Decimal('0.115'),
      profit: new Decimal('11.05'),
      marginPct: '9.22',
    },
  ],
  bestBand: 'band2',
};

const r6: CommissionTariffRow = {
  id: 'r6',
  productTitle: 'Atatürk Posteri 70x100 Çift Taraflı',
  category: 'Poster & Afiş',
  brand: 'Vatan Bayrak',
  modelCode: 'AP-70100',
  barcode: '8690000000628',
  stock: 91,
  currentPrice: new Decimal('78.50'),
  currentCommissionPct: new Decimal('0.225'),
  bands: [
    {
      key: 'band1',
      thresholdLabel: '72,90₺ ve üzeri',
      commissionPct: new Decimal('0.225'),
      profit: new Decimal('-2.10'),
      marginPct: '-2.67',
    },
    {
      key: 'band2',
      thresholdLabel: '72,89₺ ve altı',
      commissionPct: new Decimal('0.165'),
      profit: new Decimal('5.40'),
      marginPct: '6.88',
    },
    {
      key: 'band3',
      thresholdLabel: '68,90₺ ve altı',
      commissionPct: new Decimal('0.144'),
      profit: new Decimal('3.75'),
      marginPct: '5.10',
    },
    {
      key: 'band4',
      thresholdLabel: '64,90₺ ve altı',
      commissionPct: new Decimal('0.12'),
      profit: new Decimal('1.60'),
      marginPct: '2.34',
    },
  ],
  bestBand: 'band2',
};

export const MOCK_TARIFF_WEEKS: readonly TariffWeek[] = [
  {
    id: 'w-2026-06-23',
    label: 'Bu Hafta (23–30 Haz)',
    // Split tariff: two periods with partly different product sets and rates.
    periods: [
      { id: 'p-3day', dateRangeLabel: '23 Haz 08.00 – 26 Haz 07.59', rows: [r1, r2, r3] },
      { id: 'p-4day', dateRangeLabel: '26 Haz 08.00 – 30 Haz 07.59', rows: [r1, r3, r4, r5] },
    ],
  },
  {
    id: 'w-2026-06-30',
    label: 'Önümüzdeki Hafta (30 Haz–7 Tem)',
    // Single 7-day tariff: only one period, so no period sub-tabs are shown.
    periods: [
      { id: 'p-week', dateRangeLabel: '30 Haz 08.00 – 7 Tem 07.59', rows: [r1, r2, r4, r5, r6] },
    ],
  },
];
