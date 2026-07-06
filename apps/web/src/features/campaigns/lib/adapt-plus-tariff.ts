import type { PlusTariffDetail, PlusTariffDetailItem } from '../api/get-plus-tariff-detail.api';
import type { PlusTariffValidity } from '../types';

/**
 * The single Plus OFFER rendered as a band-like option (`key: 'plus'`) so the Plus
 * detail screen can share the commission vertical's winner resolver ({@link
 * resolveBestChoice}) and card cells. It is the ceiling price + reduced Plus
 * commission with the backend-computed net profit / margin.
 */
export interface PlusBand {
  key: 'plus';
  price: string;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
}

/**
 * A Plus tariff product row as the detail table consumes it. Mirrors the commission
 * `CommissionTariffRow` shape so the shared cells work: the flat CURRENT figures (the
 * price the buyer sees is `commissionBasePrice`; `currentPrice` is the seller's sale
 * price) plus the single Plus offer folded into a one-element `bands` array. Money is a
 * GROSS decimal STRING and `commissionPct` a PERCENT string — the frontend renders,
 * never computes. Uncalculable rows carry `null` profit/margin.
 */
export interface PlusTariffRow {
  id: string;
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  /** The seller's sale price. */
  currentPrice: string;
  /** The price the buyer sees — the current net profit is computed from this (never null for Plus). */
  commissionBasePrice: string;
  currentCommissionPct: string;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  /** True when the Plus offer nets more than doing nothing (drives the smart-select best pick). */
  plusIsBetter: boolean;
  calculable: boolean;
  reason: PlusTariffDetailItem['reason'];
  /** Server-authoritative: whether Plus was opted-in (at the ceiling or a custom price). */
  selected: boolean;
  /** Server-authoritative committed custom price, or null when joined at the ceiling / not joined. */
  customPrice: string | null;
  /** The single Plus offer as a band-like candidate (`bands.length === 1`). */
  bands: readonly PlusBand[];
}

/** A Plus tariff period (one 7-day window, or a piece of a split week) for the detail table. */
export interface PlusTariffPeriodView {
  id: string;
  dateRangeLabel: string;
  /** The N from "Tarih aralığı (N Gün)" — labels the sub-period tabs. */
  dayCount: number | null;
  validity: PlusTariffValidity;
  rows: readonly PlusTariffRow[];
}

/**
 * A saved Plus tariff as the detail screen consumes it. Periods are data-driven (one
 * window, or a split). `exported` is server-authoritative.
 */
export interface PlusTariffView {
  id: string;
  name: string;
  exported: boolean;
  periods: readonly PlusTariffPeriodView[];
}

/** Fold a Plus detail item into the table row shape (single offer → one-element `bands`). */
function toRow(item: PlusTariffDetailItem): PlusTariffRow {
  return {
    id: item.id,
    barcode: item.barcode,
    stockCode: item.stockCode,
    productTitle: item.productTitle,
    imageUrl: item.imageUrl,
    category: item.category,
    brand: item.brand,
    currentPrice: item.currentPrice,
    commissionBasePrice: item.commissionBasePrice,
    currentCommissionPct: item.currentCommissionPct,
    currentNetProfit: item.currentNetProfit,
    currentMarginPct: item.currentMarginPct,
    plusIsBetter: item.plusIsBetter,
    calculable: item.calculable,
    reason: item.reason,
    selected: item.selected,
    customPrice: item.customPrice,
    bands: [
      {
        key: 'plus',
        // Ground truth for the offer's ceiling: the dedicated `plusPriceUpperLimit`
        // field, NOT `plus.price`. The offer card's hero price AND the custom-price
        // input's max both key off this, so a saved custom price below the ceiling
        // can never masquerade as the ceiling. `plus.*` carries only the scenario
        // figures (commission %, profit, margin) computed at that ceiling.
        price: item.plusPriceUpperLimit,
        commissionPct: item.plus.commissionPct,
        netProfit: item.plus.netProfit,
        marginPct: item.plus.marginPct,
      },
    ],
  };
}

/**
 * Maps the backend `PlusTariffDetail` to the detail screen's `PlusTariffView`. Renames
 * each period's `items` → `rows` and folds every item's single Plus offer into a
 * band-like candidate so the row reads like a commission row. No money math — the
 * engine already computed every scenario's profit/margin.
 */
export function toPlusTariffView(detail: PlusTariffDetail): PlusTariffView {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    periods: detail.periods.map((period) => ({
      id: period.id,
      dateRangeLabel: period.dateRangeLabel,
      dayCount: period.dayCount,
      validity: period.validity,
      rows: period.items.map(toRow),
    })),
  };
}
