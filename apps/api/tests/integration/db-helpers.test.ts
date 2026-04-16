import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ensureDbReachable, truncateAll, prisma } from '../helpers/db';
import { createOrganization } from '../helpers/factories';

describe('DB test helpers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('truncateAll produces an empty organizations table', async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0);
  });

  it('createOrganization factory produces a queryable record', async () => {
    const org = await createOrganization({ name: 'Acme', slug: 'acme' });
    expect(org.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(org.name).toBe('Acme');
    expect(org.slug).toBe('acme');

    const fromDb = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fromDb?.name).toBe('Acme');
  });

  it('each test starts with an empty DB (isolation)', async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0); // proves the previous test's data was truncated
  });
});
