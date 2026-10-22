import { describe, expect, it } from 'vitest';

import type { MarketplaceCampaignListItem } from '@/features/campaigns/api/list-marketplace-campaigns.api';
import {
  hasTrendyolFunding,
  matchesMarketplaceCampaignQuery,
  statusForRow,
  summarizeMarketplaceCampaigns,
  toListRows,
  type MarketplaceCampaignListRow,
} from '@/features/campaigns/lib/marketplace-campaign-list';

function makeItem(
  overrides: Partial<MarketplaceCampaignListItem> = {},
): MarketplaceCampaignListItem {
  return {
    id: 'id-1',
    name: 'Kampanya',
    discountType: 'NET',
    valueKind: 'PERCENT',
    value: '10',
    minBasketAmount: null,
    minQuantity: null,
    buyQuantity: null,
    payQuantity: null,
    nthIndex: null,
    trendyolFundingPct: '0',
    startsAt: '2026-08-01T07:00:00.000Z',
    endsAt: '2026-08-07T20:59:59.000Z',
    itemCount: 0,
    selectedCount: 0,
    exported: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const findRow = (rows: MarketplaceCampaignListRow[], id: string): MarketplaceCampaignListRow => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
};

const items: MarketplaceCampaignListItem[] = [
  makeItem({
    id: 'a',
    name: 'Plus Discount Part 1',
    discountType: 'CONDITIONAL_BASKET',
    valueKind: 'AMOUNT',
    value: '100',
    minBasketAmount: '1000',
    trendyolFundingPct: '60',
    itemCount: 68,
    selectedCount: 12,
    exported: true,
    updatedAt: '2026-08-02T10:00:00.000Z',
  }),
  makeItem({
    id: 'b',
    name: '4 Al 2 Ode',
    discountType: 'BUY_X_PAY_Y',
    valueKind: null,
    value: null,
    buyQuantity: 4,
    payQuantity: 2,
    itemCount: 30,
    selectedCount: 0,
    updatedAt: '2026-08-03T09:00:00.000Z',
  }),
  makeItem({ id: 'c', name: 'Net indirim', itemCount: 5, selectedCount: 5 }),
];

describe('toListRows', () => {
  const rows = toListRows(items);

  it('projects every list item to a row', () => {
    expect(rows).toHaveLength(items.length);
  });

  it('carries the campaign config, funding rate and window unchanged', () => {
    const row = findRow(rows, 'a');
    expect(row.discountType).toBe('CONDITIONAL_BASKET');
    expect(row.valueKind).toBe('AMOUNT');
    expect(row.value).toBe('100');
    expect(row.minBasketAmount).toBe('1000');
    expect(row.trendyolFundingPct).toBe('60');
    expect(row.startsAt).toBe('2026-08-01T07:00:00.000Z');
    expect(row.endsAt).toBe('2026-08-07T20:59:59.000Z');
  });

  it('carries the server-computed counts and export flag', () => {
    const row = findRow(rows, 'a');
    expect(row.itemCount).toBe(68);
    expect(row.selectedCount).toBe(12);
    expect(row.exported).toBe(true);
    expect(row.updatedAt).toBe('2026-08-02T10:00:00.000Z');
  });

  it('keeps the X-al-Y-ode quantities and a null value kind', () => {
    const row = findRow(rows, 'b');
    expect(row.valueKind).toBeNull();
    expect(row.buyQuantity).toBe(4);
    expect(row.payQuantity).toBe(2);
  });
});

describe('statusForRow', () => {
  const rows = toListRows(items);

  it('reads an exported campaign as exported', () => {
    expect(statusForRow(findRow(rows, 'a'))).toBe('exported');
  });

  it('reads a not-yet-exported campaign as pending', () => {
    expect(statusForRow(findRow(rows, 'b'))).toBe('pending');
  });
});

describe('hasTrendyolFunding', () => {
  it.each(['0', '0.00', '0.0'])('treats %s as no funding', (pct) => {
    expect(hasTrendyolFunding(pct)).toBe(false);
  });

  it.each(['60', '0.5', '100'])('treats %s as funded', (pct) => {
    expect(hasTrendyolFunding(pct)).toBe(true);
  });
});

describe('summarizeMarketplaceCampaigns', () => {
  it('totals campaigns, products and selected products across the list', () => {
    const stats = summarizeMarketplaceCampaigns(toListRows(items));
    expect(stats.total).toBe(3);
    expect(stats.itemTotal).toBe(68 + 30 + 5);
    expect(stats.selectedTotal).toBe(12 + 0 + 5);
  });

  it('splits exported vs pending campaigns', () => {
    const stats = summarizeMarketplaceCampaigns(toListRows(items));
    expect(stats.exportedCount).toBe(1);
    expect(stats.pendingCount).toBe(2);
  });

  it('stamps the most recent update across the list', () => {
    const stats = summarizeMarketplaceCampaigns(toListRows(items));
    expect(stats.lastUpdatedAt).toBe('2026-08-03T09:00:00.000Z');
  });

  it('reads zeros and no stamp for an empty list', () => {
    expect(summarizeMarketplaceCampaigns([])).toEqual({
      total: 0,
      itemTotal: 0,
      selectedTotal: 0,
      exportedCount: 0,
      pendingCount: 0,
      lastUpdatedAt: null,
    });
  });
});

describe('matchesMarketplaceCampaignQuery', () => {
  const rowNamed = (name: string): MarketplaceCampaignListRow =>
    findRow(toListRows([makeItem({ id: 'x', name })]), 'x');

  it('matches every campaign when the query is empty or only whitespace', () => {
    expect(matchesMarketplaceCampaignQuery(rowNamed('Yaz Firsati'), '')).toBe(true);
    expect(matchesMarketplaceCampaignQuery(rowNamed('Yaz Firsati'), '   ')).toBe(true);
  });

  it('ignores letter case', () => {
    expect(matchesMarketplaceCampaignQuery(rowNamed('Yaz Firsati'), 'YAZ')).toBe(true);
  });

  it('lowercases the Turkish dotted capital I correctly', () => {
    expect(matchesMarketplaceCampaignQuery(rowNamed('İNDİRİM GÜNLERİ'), 'indirim')).toBe(true);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesMarketplaceCampaignQuery(rowNamed('Yaz Firsati'), '  yaz  ')).toBe(true);
  });

  it('does not match an unrelated name', () => {
    expect(matchesMarketplaceCampaignQuery(rowNamed('Yaz Firsati'), 'kis')).toBe(false);
  });
});
