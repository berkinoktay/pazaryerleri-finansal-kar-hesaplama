import { describe, expect, it } from 'vitest';

import {
  planWebhookReconcile,
  type ReconcileStore,
  type RemoteWebhook,
} from '@pazarsync/marketplace';

const BASE = 'https://x.ngrok-free.dev';
const urlFor = (storeId: string): string => `${BASE}/v1/webhooks/orders/${storeId}`;
const store = (id: string, over: Partial<ReconcileStore> = {}): ReconcileStore => ({
  id,
  webhookId: null,
  webhookSecret: null,
  ...over,
});

describe('planWebhookReconcile', () => {
  it('registers a store with no remote hook', () => {
    const plan = planWebhookReconcile({ stores: [store('s1')], remoteHooks: [], baseUrl: BASE });
    expect(plan.toRegister.map((s) => s.id)).toEqual(['s1']);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toPrune).toEqual([]);
  });

  it('no-ops a healthy store (matching hook + secret + webhookId)', () => {
    const remote: RemoteWebhook = { id: 'wh1', url: urlFor('s1') };
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'wh1', webhookSecret: 'enc' })],
      remoteHooks: [remote],
      baseUrl: BASE,
    });
    expect(plan).toEqual({ toRegister: [], toUpdate: [], toPrune: [] });
  });

  it('updates when a remote hook exists but the local secret is null', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'wh1', webhookSecret: null })],
      remoteHooks: [{ id: 'wh1', url: urlFor('s1') }],
      baseUrl: BASE,
    });
    expect(plan.toUpdate).toEqual([
      { store: expect.objectContaining({ id: 's1' }), webhookId: 'wh1' },
    ]);
    expect(plan.toRegister).toEqual([]);
    expect(plan.toPrune).toEqual([]);
  });

  it('updates when the local webhookId disagrees with the remote hook (id drift)', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'stale-id', webhookSecret: 'enc' })],
      remoteHooks: [{ id: 'wh-current', url: urlFor('s1') }],
      baseUrl: BASE,
    });
    expect(plan.toUpdate).toEqual([
      { store: expect.objectContaining({ id: 's1' }), webhookId: 'wh-current' },
    ]);
    expect(plan.toRegister).toEqual([]);
    expect(plan.toPrune).toEqual([]);
  });

  it('prunes an orphan under our base whose storeId is not active', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'wh1', webhookSecret: 'enc' })],
      remoteHooks: [
        { id: 'wh1', url: urlFor('s1') },
        { id: 'whOld', url: urlFor('deadStore') },
      ],
      baseUrl: BASE,
    });
    expect(plan.toPrune).toEqual([{ id: 'whOld', url: urlFor('deadStore') }]);
    expect(plan.toRegister).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
  });

  it('never touches a hook under a different base (prod-webhook safety invariant)', () => {
    const other: RemoteWebhook = {
      id: 'whProd',
      url: 'https://api.pazarsync.com/v1/webhooks/orders/s1',
    };
    const plan = planWebhookReconcile({
      stores: [store('s1')],
      remoteHooks: [other],
      baseUrl: BASE,
    });
    expect(plan.toPrune).toEqual([]);
    expect(plan.toRegister.map((s) => s.id)).toEqual(['s1']); // still needs an our-base hook
    expect(plan.toUpdate).toEqual([]);
  });

  it('keeps one and prunes duplicate hooks for the same store', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'wh1', webhookSecret: 'enc' })],
      remoteHooks: [
        { id: 'wh1', url: urlFor('s1') },
        { id: 'wh1dup', url: urlFor('s1') },
      ],
      baseUrl: BASE,
    });
    expect(plan.toPrune).toEqual([{ id: 'wh1dup', url: urlFor('s1') }]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRegister).toEqual([]);
  });

  it('handles multiple stores of one seller in a single pass', () => {
    const plan = planWebhookReconcile({
      stores: [
        store('s1', { webhookId: 'wh1', webhookSecret: 'enc' }), // healthy
        store('s2', { webhookId: null, webhookSecret: null }), // needs register
        store('s3', { webhookId: 'wh3', webhookSecret: null }), // needs update (secret null)
      ],
      remoteHooks: [
        { id: 'wh1', url: urlFor('s1') },
        { id: 'wh3', url: urlFor('s3') },
        { id: 'whDead', url: urlFor('goneStore') }, // orphan → prune
      ],
      baseUrl: BASE,
    });
    expect(plan.toRegister.map((s) => s.id)).toEqual(['s2']);
    expect(plan.toUpdate).toEqual([
      { store: expect.objectContaining({ id: 's3' }), webhookId: 'wh3' },
    ]);
    expect(plan.toPrune).toEqual([{ id: 'whDead', url: urlFor('goneStore') }]);
  });

  it('ignores a trailing slash on baseUrl when matching', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'wh1', webhookSecret: 'enc' })],
      remoteHooks: [{ id: 'wh1', url: urlFor('s1') }],
      baseUrl: `${BASE}/`,
    });
    expect(plan).toEqual({ toRegister: [], toUpdate: [], toPrune: [] });
  });

  it('treats a PASSIVE matching hook as unhealthy → prunes it and re-registers the store', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'whP', webhookSecret: 'enc' })],
      remoteHooks: [{ id: 'whP', url: urlFor('s1'), status: 'PASSIVE' }],
      baseUrl: BASE,
    });
    expect(plan.toRegister.map((s) => s.id)).toEqual(['s1']);
    expect(plan.toPrune).toEqual([{ id: 'whP', url: urlFor('s1'), status: 'PASSIVE' }]);
    expect(plan.toUpdate).toEqual([]);
  });

  it('prefers an ACTIVE hook over a PASSIVE duplicate for the same store', () => {
    const plan = planWebhookReconcile({
      stores: [store('s1', { webhookId: 'whP', webhookSecret: 'enc' })],
      remoteHooks: [
        { id: 'whP', url: urlFor('s1'), status: 'PASSIVE' },
        { id: 'whA', url: urlFor('s1'), status: 'ACTIVE' },
      ],
      baseUrl: BASE,
    });
    // ACTIVE hook kept (store re-pointed to it); PASSIVE one pruned, never kept.
    expect(plan.toUpdate).toEqual([
      { store: expect.objectContaining({ id: 's1' }), webhookId: 'whA' },
    ]);
    expect(plan.toPrune).toEqual([{ id: 'whP', url: urlFor('s1'), status: 'PASSIVE' }]);
    expect(plan.toRegister).toEqual([]);
  });
});
