import type { Store } from '@pazarsync/db';
import { decryptCredentials } from '@pazarsync/sync-core';

import { isTrendyolCredentials, type TrendyolCredentials } from '../trendyol/types';

/**
 * Thrown when a store's credentials decrypt successfully but are not a valid
 * Trendyol credentials shape (foreign/corrupted JSON). Distinct from the errors
 * `decryptCredentials` itself can throw — a missing `ENCRYPTION_KEY`
 * (`EncryptionKeyError` -> 500 SERVER_CONFIG_ERROR) or a GCM auth-tag / JSON
 * failure on a tampered blob (-> 500) — which propagate unchanged. Callers that
 * want a user-facing 422 catch THIS class specifically and leave the rest to
 * surface with their true status.
 */
export class StoreCredentialShapeError extends Error {
  constructor() {
    super('Invalid Trendyol credentials shape on store');
    this.name = 'StoreCredentialShapeError';
  }
}

/**
 * Decrypt a store's AES-256-GCM credential blob into typed Trendyol credentials.
 *
 * Single source of truth for every caller that needs a store's live credentials
 * for a marketplace API call — the sync-worker handlers (orders / products /
 * settlements / webhook-reconcile) and the api store service (webhook
 * register/unregister). No Utility Duplication (root CLAUDE.md).
 *
 * Prisma's `Json` column type is `JsonValue`, not `string`; the runtime value is
 * the ciphertext base64 blob, so the `as string` cast is the documented
 * Prisma-JSON exception to the no-`as` rule. The decrypt-chain errors
 * (`EncryptionKeyError`, GCM/JSON failures) propagate unchanged; only a
 * well-decrypted-but-wrong-shape blob throws the typed `StoreCredentialShapeError`.
 */
export function decryptStoreCredentials(store: Store): TrendyolCredentials {
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new StoreCredentialShapeError();
  }
  return decrypted;
}
