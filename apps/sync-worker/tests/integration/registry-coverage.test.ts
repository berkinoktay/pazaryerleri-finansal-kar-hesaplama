// Production wire-up guard for the sync-worker dispatcher registry.
//
// dispatcher.ts throws 'No handler registered for syncType=<X>' when a
// claimed SyncLog references a syncType absent from REGISTRY. The mega
// tests for each handler bypass this path by calling processChunk()
// directly with dependency-injected fetchers — a gap that let PR-7
// commit 8 ship with SETTLEMENTS unbound until stage Mode A1 validation
// surfaced the error live. This test iterates Object.values(SyncType)
// so adding a new SyncType enum value without a registry binding fails
// CI before the regression can reach stage.

import { describe, expect, it } from 'vitest';

import { SyncType } from '@pazarsync/db';

import { REGISTRY } from '../../src/registry';

describe('sync-worker registry coverage', () => {
  it('binds a handler for every SyncType enum value', () => {
    for (const syncType of Object.values(SyncType)) {
      expect(REGISTRY[syncType], `Missing handler for syncType=${syncType}`).toBeDefined();
    }
  });
});
