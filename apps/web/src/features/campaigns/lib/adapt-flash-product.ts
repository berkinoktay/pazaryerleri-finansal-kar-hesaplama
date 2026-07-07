import { type ToneKey } from '@/lib/variants';

import type {
  FlashCommissionBand,
  FlashCommissionSource,
  FlashOffer,
  FlashOfferType,
  FlashProductDetail,
  FlashProductDetailItem,
  FlashValidity,
} from '../api/get-flash-product-detail.api';
import type { FlashProductItemReason } from '../types';

/** One of the two concrete flash offers (never null) — an actual seller choice. */
export type FlashOfferKey = 'h24' | 'h3';

/** Client offer key → the backend's uppercase `FlashOfferType` enum for the selections PATCH. */
export const OFFER_KEY_TO_ENUM = {
  h24: 'H24',
  h3: 'H3',
} as const satisfies Record<FlashOfferKey, 'H24' | 'H3'>;

/** The backend's server-authoritative `selectedOffer` enum → the client offer key (null → null). */
export function offerKeyFromEnum(offer: FlashOfferType): FlashOfferKey | null {
  if (offer === 'H24') return 'h24';
  if (offer === 'H3') return 'h3';
  return null;
}

/** Flash window validity → semantic StatusDot tone; a null (unparseable) validity reads neutral. */
export const FLASH_VALIDITY_TONE: Record<NonNullable<FlashValidity>, ToneKey> = {
  active: 'success',
  upcoming: 'info',
  past: 'neutral',
};

/**
 * One flash offer (24 Saatlik / 3 Saatlik) rendered as a band-like option so the detail
 * screen can share the commission/Plus/Advantage winner resolver ({@link
 * resolveBestChoice}) and card cells: the offer's price + reduced commission with the
 * backend-computed net profit / margin, PLUS the offer's dated window (`startsAt`/`endsAt`/
 * `validity`) that heads the card. `key` is the offer slot (`h24` / `h3`);
 * `netProfit`/`marginPct` are null when the row is not calculable.
 */
export interface FlashBand {
  key: FlashOfferKey;
  /** The offer's flash price (the amount the buyer sees during the window). */
  price: string;
  commissionPct: string;
  netProfit: string | null;
  marginPct: string | null;
  /** Window start (ISO date-time); null when the file left it blank. */
  startsAt: string | null;
  /** Window end (ISO date-time); null when the file left it blank. */
  endsAt: string | null;
  /** Window status relative to the business day (active / upcoming / past), or null. */
  validity: FlashValidity;
}

/**
 * A Flash Products offer ROW as the detail table consumes it — one product × one date.
 * Mirrors the Advantage `AdvantageTariffRow` shape so the shared cells work: the flat
 * CURRENT figures plus every present flash offer folded into a `bands` array (0–2
 * elements). The SAME product appears on several rows (different dates) — that duplication
 * is expected, never de-duplicated. Money is a GROSS decimal STRING and `commissionPct` a
 * PERCENT string — the frontend renders, never computes. Uncalculable rows carry `null`
 * profit/margin.
 */
export interface FlashProductRow {
  id: string;
  barcode: string;
  /** Trendyol "Model Kodu" — the row's stock-code equivalent (identity meta + search). */
  modelCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  stock: number | null;
  /** The seller's list price. */
  currentPrice: string;
  /** The price the buyer sees — the current net profit is computed from this. */
  customerPrice: string;
  currentCommissionPct: string | null;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  calculable: boolean;
  reason: FlashProductItemReason | null;
  hasCommissionTariff: boolean;
  /** Where each offer's reduced commission came from: a commission-tariff band or the flat rate. */
  commissionSource: FlashCommissionSource;
  /**
   * The product's commission-band ladder (top-down) for the custom-price cell's ⓘ popover.
   * Null when the commission source is the flat "Mevcut Komisyon" rate (no ladder to show).
   */
  commissionBands: readonly FlashCommissionBand[] | null;
  /** Server-authoritative chosen offer (seeds the edit buffer); null when none / custom. */
  selectedOffer: FlashOfferType;
  /** Server-authoritative committed custom price, or null when offer-joined / not joined. */
  customPrice: string | null;
  /** The row's present flash offers as band-like candidates (`bands.length` is 0–2). */
  bands: readonly FlashBand[];
}

/**
 * A saved Flash Products list as the detail screen consumes it. Unlike the
 * commission/Plus verticals there are NO periods — the offer rows are held directly (each
 * carries its own dated window). `exported` is server-authoritative.
 */
export interface FlashProductView {
  id: string;
  name: string;
  exported: boolean;
  rows: readonly FlashProductRow[];
}

/** Fold a present offer into a band-like candidate, or drop it (returns []) when absent. */
function offerBand(key: FlashOfferKey, offer: FlashOffer): FlashBand[] {
  if (offer === null) return [];
  return [
    {
      key,
      price: offer.price,
      commissionPct: offer.commissionPct,
      netProfit: offer.netProfit,
      marginPct: offer.marginPct,
      startsAt: offer.startsAt,
      endsAt: offer.endsAt,
      validity: offer.validity,
    },
  ];
}

/** Fold a Flash detail item into the table row shape (present offers → `bands`). */
function toRow(item: FlashProductDetailItem): FlashProductRow {
  return {
    id: item.id,
    barcode: item.barcode,
    modelCode: item.modelCode,
    productTitle: item.productTitle,
    imageUrl: item.imageUrl,
    category: item.category,
    brand: item.brand,
    stock: item.stock,
    currentPrice: item.currentPrice,
    customerPrice: item.customerPrice,
    currentCommissionPct: item.currentCommissionPct,
    currentNetProfit: item.currentNetProfit,
    currentMarginPct: item.currentMarginPct,
    calculable: item.calculable,
    reason: item.reason,
    hasCommissionTariff: item.hasCommissionTariff,
    commissionSource: item.commissionSource,
    commissionBands: item.commissionBands,
    selectedOffer: item.selectedOffer,
    customPrice: item.customPrice,
    // Column render order — 24 Saatlik before 3 Saatlik.
    bands: [...offerBand('h24', item.offer24), ...offerBand('h3', item.offer3)],
  };
}

/**
 * Maps the backend `FlashProductDetail` to the detail screen's `FlashProductView`:
 * renames `items` → `rows` and folds every item's present offers into band-like
 * candidates + flat current figures so a row reads like an Advantage row. No money math —
 * the engine already computed every scenario's profit/margin.
 */
export function toFlashProductView(detail: FlashProductDetail): FlashProductView {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    rows: detail.items.map(toRow),
  };
}
