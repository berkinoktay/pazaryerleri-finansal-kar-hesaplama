import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore, createWebhookEvent } from '../../helpers/factories';

/**
 * PR-C1 — schema integrity for Trendyol webhook receiver foundation.
 *
 * - `stores`: new nullable columns webhookId/webhookSecret/webhookActiveAt
 * - `webhook_events`: new table + composite idempotency unique index
 *
 * Behavioural integration (auth verify, register lifecycle, route)
 * is covered by PR-C2/C3/C4.
 */
describe('PR-C1 — webhook schema integrity', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('stores: webhook columns (nullable, additive)', () => {
    it('mevcut store satırı oluşturulduğunda webhook kolonları null defaults', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      expect(store.webhookId).toBeNull();
      expect(store.webhookSecret).toBeNull();
      expect(store.webhookActiveAt).toBeNull();
    });

    it('webhook kolonları update edilebilir + tekrar null set edilebilir', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);

      const activeAt = new Date('2026-05-20T10:00:00Z');
      const filled = await prisma.store.update({
        where: { id: store.id },
        data: {
          webhookId: 'trendyol-webhook-uuid-123',
          webhookSecret: 'encrypted-blob-base64',
          webhookActiveAt: activeAt,
        },
      });
      expect(filled.webhookId).toBe('trendyol-webhook-uuid-123');
      expect(filled.webhookSecret).toBe('encrypted-blob-base64');
      expect(filled.webhookActiveAt?.toISOString()).toBe(activeAt.toISOString());

      // Manual rotation / disable senaryosu — yeniden null'a alınabilir
      const cleared = await prisma.store.update({
        where: { id: store.id },
        data: { webhookId: null, webhookSecret: null, webhookActiveAt: null },
      });
      expect(cleared.webhookId).toBeNull();
      expect(cleared.webhookSecret).toBeNull();
      expect(cleared.webhookActiveAt).toBeNull();
    });
  });

  describe('webhook_events idempotency composite unique', () => {
    it('aynı (storeId, platformOrderId, status, lastModifiedDate) tekrar INSERT P2002', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const lastModified = new Date('2026-05-20T10:00:00Z');

      await createWebhookEvent(org.id, store.id, {
        platformOrderId: 'pkg-abc',
        platformStatus: 'Delivered',
        platformLastModifiedDate: lastModified,
      });

      // Aynı 4'lü key ile ikinci INSERT — Prisma P2002 unique constraint fail
      await expect(
        createWebhookEvent(org.id, store.id, {
          platformOrderId: 'pkg-abc',
          platformStatus: 'Delivered',
          platformLastModifiedDate: lastModified,
        }),
      ).rejects.toThrow(/Unique constraint failed/);
    });

    it('farklı status ile aynı paket için ikinci event YAZILIR', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);

      const created = await createWebhookEvent(org.id, store.id, {
        platformOrderId: 'pkg-multi-status',
        platformStatus: 'Picking',
        platformLastModifiedDate: new Date('2026-05-20T10:00:00Z'),
      });
      const shipped = await createWebhookEvent(org.id, store.id, {
        platformOrderId: 'pkg-multi-status',
        platformStatus: 'Shipped',
        platformLastModifiedDate: new Date('2026-05-20T11:00:00Z'),
      });

      expect(created.id).not.toBe(shipped.id);
      const all = await prisma.webhookEvent.findMany({
        where: { storeId: store.id, platformOrderId: 'pkg-multi-status' },
      });
      expect(all).toHaveLength(2);
    });

    it('farklı store aynı paket+status+timestamp ile event YAZILIR', async () => {
      // Cross-store dedupe yok — her store kendi webhook kanalında
      const org = await createOrganization();
      const [storeA, storeB] = await Promise.all([createStore(org.id), createStore(org.id)]);
      const lastModified = new Date('2026-05-20T10:00:00Z');

      const a = await createWebhookEvent(org.id, storeA.id, {
        platformOrderId: 'pkg-shared',
        platformStatus: 'Delivered',
        platformLastModifiedDate: lastModified,
      });
      const b = await createWebhookEvent(org.id, storeB.id, {
        platformOrderId: 'pkg-shared',
        platformStatus: 'Delivered',
        platformLastModifiedDate: lastModified,
      });

      expect(a.id).not.toBe(b.id);
    });

    it('Store CASCADE DELETE webhook_events de siler', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      await createWebhookEvent(org.id, store.id);
      await createWebhookEvent(org.id, store.id, { platformStatus: 'Shipped' });

      expect(await prisma.webhookEvent.count({ where: { storeId: store.id } })).toBe(2);

      await prisma.store.delete({ where: { id: store.id } });

      expect(await prisma.webhookEvent.count({ where: { storeId: store.id } })).toBe(0);
    });

    it('Organization CASCADE DELETE webhook_events de siler', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      await createWebhookEvent(org.id, store.id);

      await prisma.organization.delete({ where: { id: org.id } });

      expect(await prisma.webhookEvent.count({ where: { organizationId: org.id } })).toBe(0);
    });
  });

  describe('webhook_events default values', () => {
    it('receivedAt defaults to now()', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const before = Date.now();
      const event = await createWebhookEvent(org.id, store.id);
      const after = Date.now();

      expect(event.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(event.receivedAt.getTime()).toBeLessThanOrEqual(after + 1000);
    });

    it('processedAt + processingError null defaults; rawPayload jsonb dolu', async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const event = await createWebhookEvent(org.id, store.id, {
        rawPayload: { shipmentPackageId: 42, status: 'Delivered' },
      });

      expect(event.processedAt).toBeNull();
      expect(event.processingError).toBeNull();
      expect(event.rawPayload).toEqual({ shipmentPackageId: 42, status: 'Delivered' });
    });
  });
});
