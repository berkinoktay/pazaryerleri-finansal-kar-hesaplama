import type { Store } from '@pazarsync/db';
import { isTrendyolCredentials, type TrendyolCredentials } from '@pazarsync/marketplace';
import { decryptCredentials } from '@pazarsync/sync-core';

/**
 * Decrypt a store's AES-256-GCM credential blob into typed Trendyol credentials.
 *
 * Single source of truth for the orders / products / settlements / webhook-
 * reconcile handlers (No Utility Duplication, root CLAUDE.md).
 *
 * Prisma's `Json` column type is `JsonValue`, not `string`; the runtime value is
 * the ciphertext base64 blob, so the `as string` cast is the documented
 * Prisma-JSON exception to the no-`as` rule. `decryptCredentials` returns
 * `unknown` — the `isTrendyolCredentials` guard narrows it and rejects a
 * corrupted or foreign-shaped blob.
 */
export function decryptStoreCredentials(store: Store): TrendyolCredentials {
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}
