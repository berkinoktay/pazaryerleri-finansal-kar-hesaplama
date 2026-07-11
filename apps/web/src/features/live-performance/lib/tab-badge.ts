// Browser tab-title unread badge. When the seller is looking at another tab, the
// new-order notifier still runs (the keep-alive channel stays open while hidden,
// see #453) and its toasts/dings go unseen. The document title is the ONE surface
// still visible in that state — it shows in the browser tab strip, the OS window
// switcher, and pinned-tab tooltips — so we prefix it with a "(N) " unread count.
// The count is reset the moment the seller returns to the tab (visible again),
// mirroring the classic webmail unread-badge convention.

/**
 * Matches a leading "(N) " unread badge already on the title, so setting a new
 * count strips the old prefix first instead of stacking "(3) (5) Title".
 */
const BADGE_PREFIX_RE = /^\(\d+\) /;

/**
 * Prefix the browser tab title with a "(N) " unread badge. Idempotent: any
 * existing "(N) " prefix is stripped before the new one is applied, so repeated
 * calls never stack (e.g. 3 then 5 yields "(5) Title", not "(5) (3) Title").
 * A non-positive count clears the badge instead of writing "(0) ". No-ops during
 * SSR where `document` is undefined.
 */
export function setTabBadgeCount(count: number): void {
  if (typeof document === 'undefined') return;
  if (count <= 0) {
    clearTabBadge();
    return;
  }
  document.title = `(${count}) ${document.title.replace(BADGE_PREFIX_RE, '')}`;
}

/**
 * Remove the "(N) " unread badge prefix from the browser tab title, leaving the
 * bare title. No-ops during SSR and when no badge prefix is present.
 */
export function clearTabBadge(): void {
  if (typeof document === 'undefined') return;
  document.title = document.title.replace(BADGE_PREFIX_RE, '');
}
