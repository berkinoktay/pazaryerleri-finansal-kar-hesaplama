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
}

export interface ReconcilePlan {
  toRegister: ReconcileStore[];
  toUpdate: { store: ReconcileStore; webhookId: string }[];
  toPrune: RemoteWebhook[];
}

const WEBHOOK_PATH = '/v1/webhooks/orders/';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function planWebhookReconcile(args: {
  stores: ReconcileStore[];
  remoteHooks: RemoteWebhook[];
  baseUrl: string;
}): ReconcilePlan {
  const base = stripTrailingSlash(args.baseUrl);
  const ourPrefix = `${base}${WEBHOOK_PATH}`;
  // SAFETY INVARIANT: only subscriptions under our own base are eligible for
  // update/prune. A hook under a different base (e.g. a prod deployment sharing
  // this Trendyol seller) is excluded here and therefore never touched.
  const ours = args.remoteHooks.filter((hook) => hook.url.startsWith(ourPrefix));

  const toRegister: ReconcileStore[] = [];
  const toUpdate: { store: ReconcileStore; webhookId: string }[] = [];
  const claimed = new Set<string>();

  for (const store of args.stores) {
    const want = `${base}${WEBHOOK_PATH}${store.id}`;
    const matches = ours.filter((hook) => hook.url === want);
    const primary = matches[0];
    if (primary === undefined) {
      toRegister.push(store);
      continue;
    }
    // Keep the first match as the store's live subscription; bind it so it is
    // not pruned. Re-register/update when the local secret is missing or the
    // locally-stored webhookId no longer agrees with the remote one.
    claimed.add(primary.id);
    if (store.webhookSecret === null || store.webhookId !== primary.id) {
      toUpdate.push({ store, webhookId: primary.id });
    }
  }

  // Every "ours" hook not claimed by an active store is either an orphan (its
  // storeId is no longer active) or a duplicate of an active store's hook —
  // both are pruned to respect Trendyol's 15-webhook-per-seller cap.
  const toPrune = ours.filter((hook) => !claimed.has(hook.id));

  return { toRegister, toUpdate, toPrune };
}
