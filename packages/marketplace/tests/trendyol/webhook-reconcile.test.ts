// Pure webhook-reconcile planner — unit tests (no HTTP, no DB).
//
// Covers register/update/prune classification and the `extraPruneBaseUrls`
// resilience behaviour (RETIRED base-URL orphan pruning):
//   - a hook under a retired base becomes a prune candidate
//   - a retired-base hook is never a claim / register target
//   - omitting extraPruneBaseUrls reproduces the exact prior behaviour (regression)
//   - toPrune is de-duplicated by id
//   - listing the ACTIVE base as an extra base does no harm (claimed hooks survive)

import { describe, expect, it } from 'vitest';

import {
  planWebhookReconcile,
  type ReconcileStore,
  type RemoteWebhook,
} from '../../src/trendyol/webhook-reconcile';
import { WEBHOOK_ORDERS_PATH } from '../../src/trendyol/webhook-paths';

const BASE = 'https://api.pazarsync.test';
const RETIRED_BASE = 'https://old-ngrok.pazarsync.test';

const urlUnder = (base: string, storeId: string): string => `${base}${WEBHOOK_ORDERS_PATH}${storeId}`;

const store = (over: Partial<ReconcileStore> & { id: string }): ReconcileStore => ({
  webhookId: null,
  webhookSecret: null,
  ...over,
});

describe('planWebhookReconcile — extraPruneBaseUrls', () => {
  it('prunes a hook under a retired extra base while the store stays healthy', () => {
    const s = store({ id: 'store-1', webhookId: 'wh-live', webhookSecret: 'sec' });
    const remoteHooks: RemoteWebhook[] = [
      { id: 'wh-live', url: urlUnder(BASE, 'store-1'), status: 'ACTIVE' },
      { id: 'wh-retired', url: urlUnder(RETIRED_BASE, 'store-1'), status: 'ACTIVE' },
    ];

    const plan = planWebhookReconcile({
      stores: [s],
      remoteHooks,
      baseUrl: BASE,
      extraPruneBaseUrls: [RETIRED_BASE],
    });

    expect(plan.toRegister).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toPrune.map((h) => h.id)).toEqual(['wh-retired']);
  });

  it('never treats a retired-base hook as a claim/register target (store still registers)', () => {
    // The store has no ACTIVE-base hook — only a leftover under the retired base.
    // The retired hook must NOT satisfy the store; it registers a fresh one and
    // the retired hook is pruned.
    const s = store({ id: 'store-1' });
    const remoteHooks: RemoteWebhook[] = [
      { id: 'wh-retired', url: urlUnder(RETIRED_BASE, 'store-1'), status: 'ACTIVE' },
    ];

    const plan = planWebhookReconcile({
      stores: [s],
      remoteHooks,
      baseUrl: BASE,
      extraPruneBaseUrls: [RETIRED_BASE],
    });

    expect(plan.toRegister.map((r) => r.id)).toEqual(['store-1']);
    expect(plan.toPrune.map((h) => h.id)).toEqual(['wh-retired']);
  });

  it('is a no-op regression when extraPruneBaseUrls is omitted (foreign hook untouched)', () => {
    const s = store({ id: 'store-1' });
    const remoteHooks: RemoteWebhook[] = [
      { id: 'wh-retired', url: urlUnder(RETIRED_BASE, 'store-1'), status: 'ACTIVE' },
    ];

    const plan = planWebhookReconcile({ stores: [s], remoteHooks, baseUrl: BASE });

    // Safety invariant preserved: a hook under a base we did not list is never
    // pruned. The store still registers its own.
    expect(plan.toRegister.map((r) => r.id)).toEqual(['store-1']);
    expect(plan.toPrune).toEqual([]);
  });

  it('de-duplicates toPrune by id when a hook matches both our-base and extra-base paths', () => {
    // An unclaimed orphan under the ACTIVE base, with the ACTIVE base ALSO
    // (mistakenly) listed as an extra base: the same id must appear once.
    const s = store({ id: 'store-1', webhookId: 'wh-live', webhookSecret: 'sec' });
    const remoteHooks: RemoteWebhook[] = [
      { id: 'wh-live', url: urlUnder(BASE, 'store-1'), status: 'ACTIVE' },
      { id: 'wh-orphan', url: urlUnder(BASE, 'dead-store'), status: 'ACTIVE' },
    ];

    const plan = planWebhookReconcile({
      stores: [s],
      remoteHooks,
      baseUrl: BASE,
      extraPruneBaseUrls: [BASE],
    });

    expect(plan.toPrune.filter((h) => h.id === 'wh-orphan')).toHaveLength(1);
    expect(plan.toPrune.map((h) => h.id)).toEqual(['wh-orphan']);
  });

  it('does no harm when the active base is passed as an extra base (claimed hook survives)', () => {
    const s = store({ id: 'store-1', webhookId: 'wh-live', webhookSecret: 'sec' });
    const remoteHooks: RemoteWebhook[] = [
      { id: 'wh-live', url: urlUnder(BASE, 'store-1'), status: 'ACTIVE' },
    ];

    const plan = planWebhookReconcile({
      stores: [s],
      remoteHooks,
      baseUrl: BASE,
      extraPruneBaseUrls: [BASE],
    });

    // The store's live, claimed hook is never pruned even though its base is in
    // the extra list.
    expect(plan.toPrune).toEqual([]);
    expect(plan.toRegister).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
  });
});
