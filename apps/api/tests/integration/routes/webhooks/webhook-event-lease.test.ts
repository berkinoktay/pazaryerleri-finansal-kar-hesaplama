/**
 * Webhook-event lease/claim primitives (Paket D §D3) — the structural gate that
 * makes concurrent double-processing of one `webhook_events` row impossible.
 *
 * These exercise `@pazarsync/webhook-ingest`'s `claimWebhookEventLease` and
 * `recordTransientProcessingFailure` directly against the real DB (Prisma
 * bypasses RLS as superuser, which is fine — the lease is a mechanism, not a
 * tenant boundary). The webhook route + the future consumer tick both rely on
 * exactly this behaviour.
 */
import { prisma } from '@pazarsync/db';
import {
  claimWebhookEventLease,
  MAX_PROCESS_ATTEMPTS,
  PROCESS_BACKOFF_MINUTES,
  recordTransientProcessingFailure,
  WEBHOOK_EVENT_LEASE_MS,
} from '@pazarsync/webhook-ingest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { createOrganization, createStore, createWebhookEvent } from '../../../helpers/factories';

async function setup(): Promise<{ orgId: string; storeId: string }> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  return { orgId: org.id, storeId: store.id };
}

/** Push `next_process_at` into the past to simulate an elapsed lease/backoff. */
async function makeEligibleNow(eventId: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { nextProcessAt: new Date(Date.now() - 1_000) },
  });
}

describe('webhook-event lease/claim (Paket D §D3)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('claim wins on a fresh row and loses while the lease is held', async () => {
    const { orgId, storeId } = await setup();
    const event = await createWebhookEvent(orgId, storeId, { processedAt: null });

    const beforeClaim = Date.now();
    const first = await claimWebhookEventLease(prisma, event.id);
    expect(first).toBe(true);

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.processAttempts).toBe(1);
    expect(row.nextProcessAt).not.toBeNull();
    // The lease deadline is ~WEBHOOK_EVENT_LEASE_MS into the future (proves the
    // interval SQL produces the right magnitude, not e.g. minutes).
    const leaseDelta = row.nextProcessAt!.getTime() - beforeClaim;
    expect(leaseDelta).toBeGreaterThan(WEBHOOK_EVENT_LEASE_MS - 10_000);
    expect(leaseDelta).toBeLessThan(WEBHOOK_EVENT_LEASE_MS + 10_000);

    // A second immediate claim loses — the lease is still held.
    const second = await claimWebhookEventLease(prisma, event.id);
    expect(second).toBe(false);
    const rowAfter = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(rowAfter.processAttempts).toBe(1);
  });

  it('re-claims once the lease has expired', async () => {
    const { orgId, storeId } = await setup();
    const event = await createWebhookEvent(orgId, storeId, { processedAt: null });

    expect(await claimWebhookEventLease(prisma, event.id)).toBe(true);
    await makeEligibleNow(event.id);
    expect(await claimWebhookEventLease(prisma, event.id)).toBe(true);

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.processAttempts).toBe(2);
  });

  it('never claims a processed (closed) row', async () => {
    const { orgId, storeId } = await setup();
    const event = await createWebhookEvent(orgId, storeId, { processedAt: new Date() });
    expect(await claimWebhookEventLease(prisma, event.id)).toBe(false);
  });

  it('transient backoff chain [1,5,15,60] then terminal on the MAX-th attempt', async () => {
    const { orgId, storeId } = await setup();
    const event = await createWebhookEvent(orgId, storeId, { processedAt: null });

    // Attempts 1..4 → non-terminal, each scheduling the next retry by its backoff.
    for (let i = 0; i < PROCESS_BACKOFF_MINUTES.length; i += 1) {
      expect(await claimWebhookEventLease(prisma, event.id)).toBe(true);

      const beforeFail = Date.now();
      await recordTransientProcessingFailure(prisma, event.id, new Error(`transient ${i + 1}`));

      const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(row.processAttempts).toBe(i + 1);
      expect(row.processedAt).toBeNull();
      expect(row.processingError).toBe(`transient ${i + 1}`);
      expect(row.nextProcessAt).not.toBeNull();
      const backoffMinutes = Math.round((row.nextProcessAt!.getTime() - beforeFail) / 60_000);
      expect(backoffMinutes).toBe(PROCESS_BACKOFF_MINUTES[i]);

      await makeEligibleNow(event.id);
    }

    // The MAX-th attempt's failure is terminal: processedAt stamped + exhausted msg.
    expect(await claimWebhookEventLease(prisma, event.id)).toBe(true);
    await recordTransientProcessingFailure(prisma, event.id, new Error('final transient'));

    const terminal = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(terminal.processAttempts).toBe(MAX_PROCESS_ATTEMPTS);
    expect(terminal.processedAt).not.toBeNull();
    expect(terminal.processingError).toContain('attempt limit exhausted (webhook ingest)');
    expect(terminal.processingError).toContain('final transient');

    // Once terminal (processed) the row can never be claimed again.
    expect(await claimWebhookEventLease(prisma, event.id)).toBe(false);
  });

  it('truncates the stored processing error to a bounded length', async () => {
    const { orgId, storeId } = await setup();
    const event = await createWebhookEvent(orgId, storeId, { processedAt: null });

    expect(await claimWebhookEventLease(prisma, event.id)).toBe(true);
    const huge = 'x'.repeat(5_000);
    await recordTransientProcessingFailure(prisma, event.id, new Error(huge));

    const row = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.processingError).not.toBeNull();
    expect(row.processingError!.length).toBe(1_000);
  });
});
