// Browser tab-title unread badge. When the seller is looking at another tab, the
// new-order notifier still runs (the keep-alive channel stays open while hidden,
// see #453) and its toasts/dings go unseen. The document title is the ONE surface
// still visible in that state — it shows in the browser tab strip, the OS window
// switcher, and pinned-tab tooltips — so we prepend an attention-grabbing label to
// it. The label is reset the moment the seller returns to the tab (visible again),
// mirroring the classic webmail unread-badge convention.
//
// Why a captured baseTitle instead of a regex prefix strip (the old "(N) "
// approach): the label is now free-form i18n copy (e.g. "🛍️ 2 yeni sipariş
// geldi!"), so a regex that recognizes and strips the previous prefix would be
// fragile — it would have to anticipate every localized shape. Capturing the bare
// title once and restoring it verbatim is deterministic regardless of the label
// text. Known limit: if the route changes WHILE a badge is active, the stale
// captured title is what gets restored. That cannot happen in practice — the badge
// is only ever set while the tab is hidden, and no client-side navigation runs on a
// hidden tab — so this is an accepted trade-off, not a live bug.

/**
 * The bare tab title captured on the first `setTabBadge` call, before any label
 * was prepended. `null` means no badge is currently active (nothing to restore).
 */
let baseTitle: string | null = null;

/**
 * Prepend an attention-grabbing label to the browser tab title, e.g.
 * "🛍️ 2 yeni sipariş geldi! · PazarSync". The bare title is captured on the FIRST
 * call (while no badge is active) and reused for every subsequent call, so repeated
 * calls never stack — a second `setTabBadge` re-prepends onto the SAME captured
 * base, it does not accumulate. No-ops during SSR where `document` is undefined.
 */
export function setTabBadge(label: string): void {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) {
    baseTitle = document.title;
  }
  document.title = `${label} · ${baseTitle}`;
}

/**
 * Restore the bare tab title captured by `setTabBadge`, removing the badge label.
 * Idempotent: no-ops when no badge is active (`baseTitle === null`) and during SSR
 * where `document` is undefined.
 */
export function clearTabBadge(): void {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) return;
  document.title = baseTitle;
  baseTitle = null;
}

/**
 * Reset the captured baseTitle so each test starts from a clean module state. The
 * badge state lives at module scope (persisting across a test file), so tests must
 * clear it between cases to stay isolated.
 */
export function resetTabBadgeForTesting(): void {
  baseTitle = null;
}
