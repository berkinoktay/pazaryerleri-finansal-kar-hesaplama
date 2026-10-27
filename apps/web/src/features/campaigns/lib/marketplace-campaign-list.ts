import type { MarketplaceCampaignListItem } from '../api/list-marketplace-campaigns.api';

/**
 * Pure derivations for the Kampanyalar (Marketplace Campaigns) LIST screen. Kept framework-free so
 * the table, the mobile cards and the summary strip read the same numbers and the logic stays
 * unit-testable. Values come straight from the backend list endpoint. Like the İndirimler list the
 * only status axis is upload/export state, and the row carries the campaign CONFIG (kurgu + its
 * parameters) so the kurgu badge and the one-line summary render without a second fetch. On top of
 * İndirimler a campaign row carries Trendyol's funding rate and the campaign window.
 */

/** The upload/export status of a saved campaign — the list's only status axis. */
export type MarketplaceCampaignListStatus = 'exported' | 'pending';

/** Flat row shape the Kampanyalar list renders — one row per saved upload. */
export interface MarketplaceCampaignListRow {
  id: string;
  name: string;
  discountType: MarketplaceCampaignListItem['discountType'];
  valueKind: MarketplaceCampaignListItem['valueKind'];
  value: string | null;
  minBasketAmount: string | null;
  minQuantity: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  nthIndex: number | null;
  /** Trendyol karşılama oranı (%), a "0"–"100" decimal string as the backend serializes it. */
  trendyolFundingPct: string;
  startsAt: string | null;
  endsAt: string | null;
  /** Product rows in the upload. */
  itemCount: number;
  /** How many rows already carry a price choice (participation progress). */
  selectedCount: number;
  exported: boolean;
  /** ISO timestamp of the last change (formatted in the row via next-intl). */
  updatedAt: string;
}

/** The upload/export status of a row (derived — the campaign window is not a status axis). */
export function statusForRow(row: MarketplaceCampaignListRow): MarketplaceCampaignListStatus {
  return row.exported ? 'exported' : 'pending';
}

/**
 * Whether Trendyol funds any share of the campaign discount. A display gate only (the funding
 * badge hides at 0 %); the rate never enters client-side arithmetic.
 */
export function hasTrendyolFunding(fundingPct: string): boolean {
  return Number(fundingPct) > 0;
}

/** Projects the backend list items into the list's flat row model (identity). */
export function toListRows(
  items: readonly MarketplaceCampaignListItem[],
): MarketplaceCampaignListRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    discountType: item.discountType,
    valueKind: item.valueKind,
    value: item.value,
    minBasketAmount: item.minBasketAmount,
    minQuantity: item.minQuantity,
    buyQuantity: item.buyQuantity,
    payQuantity: item.payQuantity,
    nthIndex: item.nthIndex,
    trendyolFundingPct: item.trendyolFundingPct,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    itemCount: item.itemCount,
    selectedCount: item.selectedCount,
    exported: item.exported,
    updatedAt: item.updatedAt,
  }));
}

/** Case-insensitive match on the upload name (the only free-text field the list carries). */
export function matchesMarketplaceCampaignQuery(
  row: MarketplaceCampaignListRow,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (needle === '') return true;
  return row.name.toLocaleLowerCase('tr').includes(needle);
}

export interface MarketplaceCampaignListStats {
  /** Total saved campaign uploads. */
  total: number;
  /** Total product rows across all uploads. */
  itemTotal: number;
  /** Total rows carrying a price choice across all uploads. */
  selectedTotal: number;
  /** How many uploads have been exported (saved & downloaded). */
  exportedCount: number;
  /** How many uploads are still awaiting export. */
  pendingCount: number;
  /** ISO timestamp of the most recent change across all uploads (trust stamp). */
  lastUpdatedAt: string | null;
}

/** At-a-glance summary metrics for the Kampanyalar list header strip. */
export function summarizeMarketplaceCampaigns(
  rows: readonly MarketplaceCampaignListRow[],
): MarketplaceCampaignListStats {
  const exportedCount = rows.filter((row) => row.exported).length;
  return {
    total: rows.length,
    itemTotal: rows.reduce((sum, row) => sum + row.itemCount, 0),
    selectedTotal: rows.reduce((sum, row) => sum + row.selectedCount, 0),
    exportedCount,
    pendingCount: rows.length - exportedCount,
    lastUpdatedAt: rows.reduce<string | null>(
      (latest, row) => (latest === null || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    ),
  };
}
