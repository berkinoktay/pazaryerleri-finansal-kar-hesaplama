import type { SyncType } from '@pazarsync/db/enums';

/**
 * The user-facing surfaces that carry a sync-freshness control. Each page maps
 * to a fixed set of upstream sync flows (see PAGE_SYNC_SOURCES). Keep this union
 * in step with the routes that render the control.
 */
export type PageSyncKey = 'orders' | 'returns' | 'products' | 'profitability' | 'dashboard';

export interface PageSyncSpec {
  /**
   * The flow(s) this page is primarily about. Ordered — the popover lists
   * primary rows before secondary ones. Every source (primary + secondary) is
   * treated equally when deriving the control state/timestamp; the split only
   * carries ordering + "which types belong to the page".
   */
  primary: readonly SyncType[];
  /** Supporting flows the page renders columns for but is not its own subject. */
  secondary: readonly SyncType[];
  /** Any source's last success older than this window reads the control 'stale'. */
  staleAfterHours: number;
  /**
   * The sync types the "Eşitle" button fires. Empty → the action half is not
   * drawn (dashboard / profitability are read-only overviews). onFlowsSettled
   * still watches the full source set, so a background flow that is not manually
   * triggerable (e.g. SETTLEMENTS elsewhere) still refreshes the page on finish.
   */
  triggerTypes: readonly SyncType[];
}

/**
 * Page → sync-flow mapping. Primary flows are the page's own subject; secondary
 * flows feed columns the page renders. Both are equal inputs to the control
 * state/timestamp — the newest success across the whole set drives the label,
 * and the worst state across the set drives the color. Data-driven so a new page
 * or upstream dependency is a config edit, not a code change.
 */
export const PAGE_SYNC_SOURCES = {
  orders: {
    primary: ['ORDERS'],
    secondary: [],
    staleAfterHours: 24,
    triggerTypes: ['ORDERS'],
  },
  returns: {
    primary: ['CLAIMS'],
    secondary: ['ORDERS'],
    staleAfterHours: 24,
    triggerTypes: ['CLAIMS'],
  },
  products: {
    primary: ['PRODUCTS', 'PRODUCTS_DELTA'],
    secondary: [],
    staleAfterHours: 24,
    triggerTypes: ['PRODUCTS'],
  },
  profitability: {
    primary: ['SETTLEMENTS'],
    secondary: ['ORDERS'],
    staleAfterHours: 48,
    triggerTypes: [],
  },
  dashboard: {
    primary: ['ORDERS', 'PRODUCTS', 'PRODUCTS_DELTA', 'SETTLEMENTS', 'CLAIMS'],
    secondary: [],
    staleAfterHours: 24,
    triggerTypes: [],
  },
} as const satisfies Record<PageSyncKey, PageSyncSpec>;
