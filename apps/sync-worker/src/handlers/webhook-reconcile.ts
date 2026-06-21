/**
 * Self-healing Trendyol webhook reconcile tick.
 *
 * For every ACTIVE TRENDYOL store, ensures exactly one healthy webhook
 * subscription points at `${PUBLIC_API_BASE_URL}/v1/webhooks/orders/{storeId}`,
 * and prunes Trendyol-side orphans (subscriptions whose storeId is no longer
 * active) — fully automatically, surviving db resets, sandbox testing, failed
 * connects, and base-URL/ngrok changes. Invisible to end users.
 *
 * Idempotent: in steady state each tick is one GET per distinct seller with no
 * writes. Per-seller failures are isolated and logged so one bad seller never
 * blocks the others, and the tick wrapper keeps the worker from ever crashing.
 *
 * Trendyol webhooks are per-seller (one subscription set per `externalAccountId`
 * == supplierId), so stores are grouped by seller and reconciled one at a time.
 *
 * SAFETY: `planWebhookReconcile` only ever updates/prunes subscriptions whose
 * callback URL is under our own `PUBLIC_API_BASE_URL` — see its safety
 * invariant. A dev/ngrok reconciler can never delete a production deployment's
 * webhooks, even when they share the same Trendyol seller.
 */

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  getTrendyolWebhooks,
  planWebhookReconcile,
  registerStoreWebhook,
  rotateStoreWebhookSecret,
  unregisterStoreWebhook,
  type ReconcileStore,
} from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

/**
 * Our public base URL, normalized. `null` when unset or non-HTTPS — Trendyol
 * rejects non-HTTPS callbacks, and registering against a wrong/empty base would
 * create webhooks we can never receive, so the tick skips entirely in that case.
 */
function readPublicApiBaseUrl(): string | null {
  const raw = (process.env['PUBLIC_API_BASE_URL'] ?? '').replace(/\/$/, '');
  return raw.startsWith('https://') ? raw : null;
}

// Fire-once guard: this tick runs every 5 min, so warning on each skip spams
// the log. Boot's validateRequiredEnv already covers the missing case; this
// one-time warning additionally catches a present-but-non-https value.
let baseUrlSkipWarned = false;

export async function processWebhookReconcile(): Promise<void> {
  const baseUrl = readPublicApiBaseUrl();
  if (baseUrl === null) {
    if (!baseUrlSkipWarned) {
      baseUrlSkipWarned = true;
      syncLog.warn('webhook.reconcile-skipped', {
        reason: 'PUBLIC_API_BASE_URL missing or not https',
        hint: 'Set PUBLIC_API_BASE_URL to your public https URL to enable Trendyol webhooks.',
      });
    }
    return;
  }
  baseUrlSkipWarned = false;

  const stores = await prisma.store.findMany({
    where: { platform: 'TRENDYOL', status: 'ACTIVE' },
  });

  // Group by seller — Trendyol webhooks are per-seller, so all stores of one
  // seller share a single remote subscription list.
  const bySeller = new Map<string, Store[]>();
  for (const store of stores) {
    const group = bySeller.get(store.externalAccountId) ?? [];
    group.push(store);
    bySeller.set(store.externalAccountId, group);
  }

  for (const [sellerId, sellerStores] of bySeller) {
    try {
      await reconcileSeller(sellerStores, baseUrl);
    } catch (err) {
      // Isolate per-seller failures: a Trendyol error or a corrupt credential
      // for one seller must not block the others; retried next tick.
      syncLog.error('webhook.reconcile-seller-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function reconcileSeller(sellerStores: Store[], baseUrl: string): Promise<void> {
  const first = sellerStores[0];
  if (first === undefined) return;

  // One seller → one credential set drives the per-seller GET + prune. Register
  // and update decrypt each store's own credentials (identical in practice for a
  // shared seller, but we never assume they are).
  const sellerCredentials = decryptStoreCredentials(first);
  const remoteHooks = await getTrendyolWebhooks({
    credentials: sellerCredentials,
    env: first.environment,
  });

  const plan = planWebhookReconcile({
    stores: sellerStores.map<ReconcileStore>((store) => ({
      id: store.id,
      webhookId: store.webhookId,
      webhookSecret: store.webhookSecret,
    })),
    remoteHooks,
    baseUrl,
  });

  const storeById = new Map(sellerStores.map((store) => [store.id, store]));

  // PRUNE FIRST — before register/update. Trendyol caps a seller at 15 webhook
  // subscriptions (PASSIVE ones included). The reconciler's primary job is to
  // heal a seller that accumulated orphans across db resets — exactly the case
  // where the seller can sit at/near the cap. Registering first would let
  // Trendyol reject the POST (cap exceeded), throw, and skip the prune entirely,
  // a permanent deadlock. Pruning first frees the slots. planWebhookReconcile
  // only ever puts unclaimed orphan / duplicate / PASSIVE hooks in toPrune
  // (never an active store's live hook), so pruning before registering is safe.
  for (const hook of plan.toPrune) {
    await unregisterStoreWebhook({
      credentials: sellerCredentials,
      env: first.environment,
      webhookId: hook.id,
    });
    syncLog.info('webhook.reconcile-pruned', { webhookId: hook.id, url: hook.url });
  }

  for (const target of plan.toRegister) {
    const store = storeById.get(target.id);
    if (store === undefined) continue;
    const { webhookId, encryptedSecret } = await registerStoreWebhook({
      storeId: store.id,
      baseUrl,
      credentials: decryptStoreCredentials(store),
      env: store.environment,
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { webhookId, webhookSecret: encryptedSecret, webhookActiveAt: new Date() },
    });
    syncLog.info('webhook.reconcile-registered', { storeId: store.id });
  }

  for (const { store: target, webhookId } of plan.toUpdate) {
    const store = storeById.get(target.id);
    if (store === undefined) continue;
    const { encryptedSecret } = await rotateStoreWebhookSecret({
      storeId: store.id,
      baseUrl,
      credentials: decryptStoreCredentials(store),
      env: store.environment,
      webhookId,
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { webhookId, webhookSecret: encryptedSecret, webhookActiveAt: new Date() },
    });
    syncLog.info('webhook.reconcile-updated', { storeId: store.id });
  }
}
