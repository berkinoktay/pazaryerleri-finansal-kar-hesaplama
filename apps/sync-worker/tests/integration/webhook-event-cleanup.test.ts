import { prisma } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processWebhookEventCleanup } from '../../src/handlers/webhook-event-cleanup';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createOrganization,
  createStore,
  createWebhookEvent,
} from '../../../../apps/api/tests/helpers/factories';

const RETENTION_ENV = 'WEBHOOK_EVENT_RETENTION_DAYS';
const DAY_MS = 24 * 60 * 60_000;

/**
 * Seed a webhook_events row aged `ageDays` in the past. `receivedAt` has a
 * `now()` default with no factory override, so it is pulled back via a follow-up
 * update.
 *
 * Rows default to PROCESSED (processed_at stamped) because cleanup only prunes
 * closed rows — an aged row that should be deletable must be processed. Pass
 * `{ processed: false }` to seed an outstanding (unprocessed) queue row, which
 * cleanup must never touch regardless of age.
 */
async function seedEventAged(
  organizationId: string,
  storeId: string,
  ageDays: number,
  options: { processed?: boolean } = {},
): Promise<string> {
  const agedDate = new Date(Date.now() - ageDays * DAY_MS);
  const processed = options.processed ?? true;
  const event = await createWebhookEvent(organizationId, storeId, {
    processedAt: processed ? agedDate : null,
  });
  await prisma.webhookEvent.update({
    where: { id: event.id },
    data: { receivedAt: agedDate },
  });
  return event.id;
}

async function exists(id: string): Promise<boolean> {
  const row = await prisma.webhookEvent.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

describe('processWebhookEventCleanup', () => {
  let savedRetention: string | undefined;

  beforeAll(async () => {
    await ensureDbReachable();
    savedRetention = process.env[RETENTION_ENV];
  });

  beforeEach(async () => {
    await truncateAll();
    // Clean slate — the default (90 days) path unless a case sets an override.
    delete process.env[RETENTION_ENV];
  });

  afterEach(() => {
    if (savedRetention === undefined) delete process.env[RETENTION_ENV];
    else process.env[RETENTION_ENV] = savedRetention;
  });

  it('prunes events older than the default retention window and keeps recent ones', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Two beyond the 90-day cutoff, two well within it.
    const old1 = await seedEventAged(org.id, store.id, 120);
    const old2 = await seedEventAged(org.id, store.id, 100);
    const new1 = await seedEventAged(org.id, store.id, 10);
    const new2 = await seedEventAged(org.id, store.id, 1);

    await processWebhookEventCleanup();

    expect(await exists(old1)).toBe(false);
    expect(await exists(old2)).toBe(false);
    expect(await exists(new1)).toBe(true);
    expect(await exists(new2)).toBe(true);
  });

  it('honours a WEBHOOK_EVENT_RETENTION_DAYS override for a shorter window', async () => {
    process.env[RETENTION_ENV] = '30';
    const org = await createOrganization();
    const store = await createStore(org.id);
    // 45 days is beyond the 30-day override but within the 90-day default —
    // proves the override actually narrows the window.
    const beyond = await seedEventAged(org.id, store.id, 45);
    const within = await seedEventAged(org.id, store.id, 10);

    await processWebhookEventCleanup();

    expect(await exists(beyond)).toBe(false);
    expect(await exists(within)).toBe(true);
  });

  it('never prunes an unprocessed event even when it is older than the retention window', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Both aged 120 days — well beyond the 90-day default. The processed one ages
    // out normally; the unprocessed one is still outstanding queue work (Paket D
    // ingest queue) and must survive so the consumer tick can eventually pick it
    // up. Deleting it would silently drop the order.
    const processedOld = await seedEventAged(org.id, store.id, 120, { processed: true });
    const unprocessedOld = await seedEventAged(org.id, store.id, 120, { processed: false });

    await processWebhookEventCleanup();

    expect(await exists(processedOld)).toBe(false);
    expect(await exists(unprocessedOld)).toBe(true);
  });

  it('falls back to the 90-day default when the env value is invalid', async () => {
    process.env[RETENTION_ENV] = 'not-a-number';
    const org = await createOrganization();
    const store = await createStore(org.id);
    // 60 days is newer than the 90-day default → must survive; 120 days is
    // beyond it → must be pruned. Together they prove the default window applies
    // rather than the garbage value being coerced into some other cutoff.
    const kept = await seedEventAged(org.id, store.id, 60);
    const pruned = await seedEventAged(org.id, store.id, 120);

    await processWebhookEventCleanup();

    expect(await exists(kept)).toBe(true);
    expect(await exists(pruned)).toBe(false);
  });
});
