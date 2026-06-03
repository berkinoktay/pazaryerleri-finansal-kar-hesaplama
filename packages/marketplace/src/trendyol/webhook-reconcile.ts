/**
 * Pure webhook-reconcile planner — decides register / update / prune for ONE
 * seller's webhook subscriptions.
 *
 * No HTTP, no DB: the input is the seller's active stores + the seller's current
 * remote subscriptions (from `getTrendyolWebhooks`) + our own base URL; the
 * output is the set of actions the worker applies. This is the testable heart of
 * the self-healing reconciler — the worker tick is a thin IO shell around it.
 *
 * SAFETY INVARIANT: only subscriptions whose callback URL is under `baseUrl`
 * (our own `PUBLIC_API_BASE_URL`) are ever considered for update or prune. Hooks
 * under a different base — e.g. a production deployment that shares the same
 * Trendyol seller — are filtered out up front, so a dev/ngrok reconciler can
 * never delete a production deployment's webhooks.
 */

import { WEBHOOK_ORDERS_PATH } from './webhook-paths';

/** The fields of an active store the planner reasons about (scoped to one seller). */
export interface ReconcileStore {
  id: string;
  webhookId: string | null;
  webhookSecret: string | null;
}

/** A remote subscription as reported by `getTrendyolWebhooks`. */
export interface RemoteWebhook {
  id: string;
  url: string;
  /** Trendyol subscription status ('ACTIVE' | 'PASSIVE'); absent → treated as live. */
  status?: string;
}

export interface ReconcilePlan {
  toRegister: ReconcileStore[];
  toUpdate: { store: ReconcileStore; webhookId: string }[];
  toPrune: RemoteWebhook[];
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * A subscription Trendyol has auto-deactivated (PASSIVE) silently stops
 * delivering, and only the seller can revive it; we heal it by pruning +
 * re-registering a fresh ACTIVE one. Any other / absent status is treated as
 * live so an unexpected value never causes over-pruning.
 */
function isLive(hook: RemoteWebhook): boolean {
  return hook.status !== 'PASSIVE';
}

export function planWebhookReconcile(args: {
  stores: ReconcileStore[];
  remoteHooks: RemoteWebhook[];
  baseUrl: string;
}): ReconcilePlan {
  const base = stripTrailingSlash(args.baseUrl);
  const ourPrefix = `${base}${WEBHOOK_ORDERS_PATH}`;
  // SAFETY INVARIANT: only subscriptions under our own base are eligible for
  // update/prune. A hook under a different base (e.g. a prod deployment sharing
  // this Trendyol seller) is excluded here and therefore never touched.
  const ours = args.remoteHooks.filter((hook) => hook.url.startsWith(ourPrefix));

  const toRegister: ReconcileStore[] = [];
  const toUpdate: { store: ReconcileStore; webhookId: string }[] = [];
  const claimed = new Set<string>();

  for (const store of args.stores) {
    const want = `${base}${WEBHOOK_ORDERS_PATH}${store.id}`;
    const matches = ours.filter((hook) => hook.url === want);
    // Only a LIVE (non-PASSIVE) hook counts as the store's healthy subscription;
    // prefer the one the store already tracks to avoid needless churn. PASSIVE
    // matches stay unclaimed → pruned, and the store (re)registers a fresh one.
    const live = matches.filter(isLive);
    const primary = live.find((hook) => hook.id === store.webhookId) ?? live[0];
    if (primary === undefined) {
      toRegister.push(store);
      continue;
    }
    claimed.add(primary.id);
    if (store.webhookSecret === null || store.webhookId !== primary.id) {
      toUpdate.push({ store, webhookId: primary.id });
    }
  }

  // Every "ours" hook not claimed by an active store is an orphan (dead
  // storeId), a duplicate, or a PASSIVE hook being replaced — all pruned to
  // respect Trendyol's 15-webhook-per-seller cap. The worker prunes BEFORE
  // registering so freeing these slots never collides with that cap.
  const toPrune = ours.filter((hook) => !claimed.has(hook.id));

  return { toRegister, toUpdate, toPrune };
}
