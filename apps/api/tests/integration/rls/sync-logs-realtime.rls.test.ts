// Realtime tenant isolation for sync_logs (spec §12 T1).
//
// The REST/RLS path is already covered by sync-logs-org.test.ts and
// settlements-synclogs.rls.test.ts. The Realtime/postgres_changes path
// is a different code path inside Supabase (logical decoding emits the
// row, the Realtime server filters by the channel filter + RLS) — so
// it needs its own evaluator.
//
// We assert: a sync_logs row inserted in org B is NEVER delivered to
// user A's Realtime channel filtered on org A; rows inserted in org A
// ARE delivered.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { prisma } from '@pazarsync/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

const SUBSCRIBE_TIMEOUT_MS = 5_000;
const NEGATIVE_WAIT_MS = 2_000;
const POSITIVE_WAIT_MS = 3_000;

function waitForSubscribed(channel: RealtimeChannel, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      if (channel.state === 'joined') {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Channel did not reach 'joined' within ${timeoutMs.toString()}ms`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('Realtime tenant isolation — sync_logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // Tracks any channels opened in a test so afterAll can clean up even
  // if a test exits early. Each test still removes its own channel
  // explicitly — this is just defense in depth.
  const openChannels: RealtimeChannel[] = [];
  afterAll(async () => {
    for (const ch of openChannels) {
      try {
        await ch.unsubscribe();
      } catch {
        // best effort
      }
    }
  });

  it("user A's Realtime channel does NOT receive events from org B's syncs", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const { user: userB } = await createRlsScopedClient();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);

    // The REST Authorization header set in createRlsScopedClient does NOT
    // reach the Realtime WebSocket — Realtime auth is a separate channel.
    // Without setAuth the server sees us as anon, RLS blocks every event,
    // and the negative case below would pass for the wrong reason. Set
    // it before subscribe so the policy evaluator sees the right uid.
    clientA.realtime.setAuth(userA.accessToken);

    const events: unknown[] = [];
    const channel = clientA
      .channel(`sync_logs:org:${orgA.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_logs',
          filter: `organization_id=eq.${orgA.id}`,
        },
        (payload) => events.push(payload),
      )
      .subscribe();
    openChannels.push(channel);

    await waitForSubscribed(channel, SUBSCRIBE_TIMEOUT_MS);

    // INSERT in org B (Prisma bypasses RLS, simulating a real
    // cross-tenant write that Realtime sees in its decoded stream).
    await prisma.syncLog.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Wait long enough for Realtime to deliver if it were going to —
    // local server typically delivers in <500 ms.
    await sleep(NEGATIVE_WAIT_MS);

    expect(events).toEqual([]);

    await clientA.removeChannel(channel);
  });

  it("user A's Realtime channel DOES receive events from its own org's syncs", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');
    const storeA = await createStore(orgA.id);

    clientA.realtime.setAuth(userA.accessToken);

    const events: unknown[] = [];
    const channel = clientA
      .channel(`sync_logs:org:${orgA.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_logs',
          filter: `organization_id=eq.${orgA.id}`,
        },
        (payload) => events.push(payload),
      )
      .subscribe();
    openChannels.push(channel);

    await waitForSubscribed(channel, SUBSCRIBE_TIMEOUT_MS);

    await prisma.syncLog.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Poll up to POSITIVE_WAIT_MS for at least one event to arrive.
    const deadline = Date.now() + POSITIVE_WAIT_MS;
    while (events.length === 0 && Date.now() < deadline) {
      await sleep(50);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);

    await clientA.removeChannel(channel);
  });
});
