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
 * Trendyol webhooks are per-seller-per-environment (one subscription set per
 * `externalAccountId` == supplierId, keyed additionally by PROD vs SANDBOX so a
 * shared supplierId in two environments never fights over one remote list), so
 * stores are grouped by `${externalAccountId}::${environment}` and reconciled
 * one group at a time.
 *
 * SAFETY: `planWebhookReconcile` only ever updates/prunes subscriptions whose
 * callback URL is under our own `PUBLIC_API_BASE_URL` (or an operator-listed
 * RETIRED base via `WEBHOOK_PRUNE_EXTRA_BASE_URLS`) — see its safety invariant.
 * A dev/ngrok reconciler can never delete a production deployment's webhooks,
 * even when they share the same Trendyol seller.
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
  type RemoteWebhook,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

/** Trendyol caps a seller at this many webhook subscriptions (PASSIVE ones included). */
const TRENDYOL_WEBHOOK_CAP = 15;
/**
 * Emit an observability warning once a seller's remote subscription count
 * reaches this threshold — a couple of slots below the hard cap — so orphan
 * accumulation is visible before a register starts failing with cap-exceeded.
 */
const WEBHOOK_SELLER_CAP_WARN_AT = 13;

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

// Fire-once guard for the same reason: a non-https entry in the
// WEBHOOK_PRUNE_EXTRA_BASE_URLS list is a config typo, not a per-tick event.
let extraPruneBaseSkipWarned = false;

/**
 * Parse `WEBHOOK_PRUNE_EXTRA_BASE_URLS` — a comma-separated list of RETIRED
 * public base URLs (old domains / rotated ngrok hosts) whose leftover Trendyol
 * subscriptions the reconciler should additionally prune. Each entry is trimmed
 * and trailing-slash-stripped; non-https entries are silently dropped (with a
 * one-time warning) since Trendyol callbacks are always https. The currently
 * active base is filtered out so a stale copy of it can never fight the live
 * claim logic. Runtime-only + optional: unset → empty list → default behaviour.
 */
function readExtraPruneBaseUrls(activeBaseUrl: string): string[] {
  const raw = process.env['WEBHOOK_PRUNE_EXTRA_BASE_URLS'];
  if (raw === undefined || raw.trim().length === 0) return [];

  const result: string[] = [];
  let sawNonHttps = false;
  for (const part of raw.split(',')) {
    const normalized = part.trim().replace(/\/$/, '');
    if (normalized.length === 0) continue;
    if (!normalized.startsWith('https://')) {
      sawNonHttps = true;
      continue;
    }
    // The active base's hooks are governed by the live claim logic, never the
    // retired-prune path — filter it out even if an operator left it in the list.
    if (normalized === activeBaseUrl) continue;
    result.push(normalized);
  }

  if (sawNonHttps && !extraPruneBaseSkipWarned) {
    extraPruneBaseSkipWarned = true;
    syncLog.warn('webhook.reconcile-extra-prune-base-skipped', {
      syncType: 'webhook-reconcile',
      reason: 'WEBHOOK_PRUNE_EXTRA_BASE_URLS contained one or more non-https entries (ignored)',
      hint: 'Every Trendyol callback base is https; fix or remove the offending entry.',
    });
  }

  return result;
}

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

  const extraPruneBaseUrls = readExtraPruneBaseUrls(baseUrl);

  const stores = await prisma.store.findMany({
    where: { platform: 'TRENDYOL', status: 'ACTIVE' },
  });

  // Group by seller AND environment — Trendyol webhooks are per-seller, and a
  // single supplierId can be connected in both PROD and SANDBOX. Mixing the two
  // into one group would reconcile a sandbox store against the production
  // remote list (and vice versa), re-creating duplicates every tick.
  const bySeller = new Map<string, Store[]>();
  for (const store of stores) {
    const key = `${store.externalAccountId}::${store.environment}`;
    const group = bySeller.get(key) ?? [];
    group.push(store);
    bySeller.set(key, group);
  }

  for (const sellerStores of bySeller.values()) {
    const first = sellerStores[0];
    if (first === undefined) continue;
    try {
      await reconcileSeller(sellerStores, baseUrl, extraPruneBaseUrls);
    } catch (err) {
      // Isolate per-seller failures: a Trendyol error or an all-credentials-dead
      // seller must not block the others; retried next tick.
      syncLog.error('webhook.reconcile-seller-error', {
        syncType: 'webhook-reconcile',
        sellerId: first.externalAccountId,
        environment: first.environment,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function reconcileSeller(
  sellerStores: Store[],
  baseUrl: string,
  extraPruneBaseUrls: string[],
): Promise<void> {
  // Deterministic order: never rely on findMany's ordering. A stable sort by id
  // makes the credential-fallback sequence and the register order reproducible.
  const stores = [...sellerStores].sort((a, b) => a.id.localeCompare(b.id));
  const first = stores[0];
  if (first === undefined) return;

  const sellerId = first.externalAccountId;
  const env = first.environment;

  // Per-seller GET with credential fallback: try each store's credentials in
  // order until one succeeds. A single store's DEAD credential (corrupt blob or
  // revoked key) must never block the whole shared-seller group from healing
  // forever. The winning credential also drives the prune calls below.
  let remoteHooks: RemoteWebhook[] | undefined;
  let sellerCredentials: TrendyolCredentials | undefined;
  let lastError: unknown;
  for (const store of stores) {
    let credentials: TrendyolCredentials;
    try {
      credentials = decryptStoreCredentials(store);
    } catch (err) {
      lastError = err;
      syncLog.warn('webhook.reconcile-credential-failed', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      remoteHooks = await getTrendyolWebhooks({ credentials, env });
      sellerCredentials = credentials;
      break;
    } catch (err) {
      lastError = err;
      syncLog.warn('webhook.reconcile-credential-failed', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (remoteHooks === undefined || sellerCredentials === undefined) {
    // Every store's credential failed → nothing to reconcile this tick. Surface
    // the last error so the per-seller catch logs it and moves to other sellers.
    throw lastError instanceof Error
      ? lastError
      : new Error(`No usable credentials for seller ${sellerId}`);
  }

  // Cap-approach observability: warn (once we near Trendyol's 15-hook cap) so
  // orphan build-up is visible before a register starts failing cap-exceeded.
  if (remoteHooks.length >= WEBHOOK_SELLER_CAP_WARN_AT) {
    syncLog.warn('webhook.seller-near-cap', {
      syncType: 'webhook-reconcile',
      sellerId,
      environment: env,
      count: remoteHooks.length,
      cap: TRENDYOL_WEBHOOK_CAP,
    });
  }

  const plan = planWebhookReconcile({
    stores: stores.map<ReconcileStore>((store) => ({
      id: store.id,
      webhookId: store.webhookId,
      webhookSecret: store.webhookSecret,
    })),
    remoteHooks,
    baseUrl,
    extraPruneBaseUrls,
  });

  const storeById = new Map(stores.map((store) => [store.id, store]));

  // PRUNE FIRST — before register/update. Trendyol caps a seller at 15 webhook
  // subscriptions (PASSIVE ones included). The reconciler's primary job is to
  // heal a seller that accumulated orphans across db resets — exactly the case
  // where the seller can sit at/near the cap. Registering first would let
  // Trendyol reject the POST (cap exceeded), throw, and skip the prune entirely,
  // a permanent deadlock. Pruning first frees the slots. planWebhookReconcile
  // only ever puts unclaimed orphan / duplicate / PASSIVE hooks in toPrune
  // (never an active store's live hook), so pruning before registering is safe.
  for (const hook of plan.toPrune) {
    try {
      await unregisterStoreWebhook({
        credentials: sellerCredentials,
        env,
        webhookId: hook.id,
      });
      syncLog.info('webhook.reconcile-pruned', { webhookId: hook.id, url: hook.url });
    } catch (err) {
      // Isolate per-hook prune failures: a ghost/double-delete 404 (or any other
      // Trendyol error) on ONE orphan must never abort the seller group's
      // registers. Worst case this tick: the slot is not freed, so a subsequent
      // register may hit the 15-hook cap and fail into its own isolated catch —
      // retried next tick. Continue to the next hook regardless.
      syncLog.warn('webhook.reconcile-prune-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        environment: env,
        webhookId: hook.id,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const target of plan.toRegister) {
    const store = storeById.get(target.id);
    if (store === undefined) continue;

    let registered: { webhookId: string; encryptedSecret: string };
    try {
      registered = await registerStoreWebhook({
        storeId: store.id,
        baseUrl,
        credentials: decryptStoreCredentials(store),
        env: store.environment,
      });
    } catch (err) {
      // Isolate per-store register failures (dead credential decrypt, Trendyol
      // reject, or cap-exceeded because a prune above could not free a slot):
      // one store must never block the others in the shared group. No Trendyol
      // subscription was created, so nothing to adopt — retried next tick.
      syncLog.error('webhook.reconcile-store-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    try {
      await prisma.store.update({
        where: { id: store.id },
        data: {
          webhookId: registered.webhookId,
          webhookSecret: registered.encryptedSecret,
          webhookActiveAt: new Date(),
        },
      });
      syncLog.info('webhook.reconcile-registered', { storeId: store.id });
    } catch (err) {
      // Trendyol created the subscription but our DB write failed: a live
      // subscription our DB does not track (store.webhookId stays null). Next
      // tick's GET finds it under our base and toUpdate adopts it (null webhookId
      // matches by url), so it self-heals — flag orphanRisk so the window is
      // visible meanwhile.
      syncLog.error('webhook.reconcile-store-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        orphanRisk: true,
        hint: 'Trendyol subscription created but DB write failed; next tick adopts it via toUpdate.',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const { store: target, webhookId } of plan.toUpdate) {
    const store = storeById.get(target.id);
    if (store === undefined) continue;

    let rotated: { encryptedSecret: string };
    try {
      rotated = await rotateStoreWebhookSecret({
        storeId: store.id,
        baseUrl,
        credentials: decryptStoreCredentials(store),
        env: store.environment,
        webhookId,
      });
    } catch (err) {
      // Same per-store isolation as the register loop: the Trendyol PUT failed,
      // so nothing was rotated — retried next tick.
      syncLog.error('webhook.reconcile-store-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    try {
      await prisma.store.update({
        where: { id: store.id },
        data: { webhookId, webhookSecret: rotated.encryptedSecret, webhookActiveAt: new Date() },
      });
      syncLog.info('webhook.reconcile-updated', { storeId: store.id });
    } catch (err) {
      // Trendyol rotated the subscription secret but our DB write failed: the
      // remote now expects a secret our DB does not hold, so inbound webhooks
      // fail Basic Auth until we catch up. store.webhookSecret stays stale/null,
      // so next tick re-enters toUpdate and re-rotates — self-heals; flag
      // orphanRisk so the mismatch window is visible.
      syncLog.error('webhook.reconcile-store-error', {
        syncType: 'webhook-reconcile',
        sellerId,
        storeId: store.id,
        environment: env,
        orphanRisk: true,
        hint: 'Trendyol subscription secret rotated but DB write failed; next tick re-rotates via toUpdate.',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
