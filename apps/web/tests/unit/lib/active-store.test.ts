import { describe, expect, it, vi, beforeEach } from 'vitest';

import { resolveActiveStoreId } from '@/lib/active-store';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

beforeEach(() => {
  cookieStore.get.mockReset();
});

const STORES = [{ id: 'store-1' }, { id: 'store-2' }, { id: 'store-3' }] as const;

describe('resolveActiveStoreId', () => {
  it('returns undefined when the org has no stores', async () => {
    cookieStore.get.mockReturnValue(undefined);
    expect(await resolveActiveStoreId([])).toBeUndefined();
  });

  it('returns the cookie value when it points at an existing store', async () => {
    cookieStore.get.mockReturnValue({ value: 'store-2' });
    expect(await resolveActiveStoreId([...STORES])).toBe('store-2');
  });

  it('falls back to the first store when the cookie is missing', async () => {
    cookieStore.get.mockReturnValue(undefined);
    expect(await resolveActiveStoreId([...STORES])).toBe('store-1');
  });

  it('falls back to the first store when the cookie points at a deleted store', async () => {
    cookieStore.get.mockReturnValue({ value: 'store-deleted' });
    expect(await resolveActiveStoreId([...STORES])).toBe('store-1');
  });
});
