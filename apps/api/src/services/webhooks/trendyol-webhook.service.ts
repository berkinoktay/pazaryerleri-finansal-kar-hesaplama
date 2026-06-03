/**
 * Trendyol webhook orchestration — `apps/api` env adapter.
 *
 * The orchestration itself lives in `@pazarsync/marketplace`
 * (`trendyol/webhook-orchestration.ts`), shared with `apps/sync-worker`. This
 * module is the thin `apps/api` adapter: it injects the api's
 * `PUBLIC_API_BASE_URL` (via `requireEnv`) into the shared `baseUrl` parameter,
 * so existing callers (`storeService.connect` / `rotateWebhookSecret` /
 * `disconnect`) keep their env-free call shape and the unit test contract is
 * unchanged. No business logic lives here anymore.
 *
 * Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §4.1, §7.4
 */

import {
  buildWebhookCallbackUrl as buildSharedWebhookCallbackUrl,
  generateWebhookCredentials,
  registerStoreWebhook as registerStoreWebhookShared,
  rotateStoreWebhookSecret as rotateStoreWebhookSecretShared,
  unregisterStoreWebhook,
  type RegisterStoreWebhookArgs,
  type RegisterStoreWebhookResult,
  type RotateStoreWebhookArgs,
  type UnregisterStoreWebhookArgs,
  type WebhookReceiverCredentials,
} from '@pazarsync/marketplace';

import { requireEnv } from '../../lib/env';

export { generateWebhookCredentials, unregisterStoreWebhook };
export type { RegisterStoreWebhookResult, UnregisterStoreWebhookArgs, WebhookReceiverCredentials };

/**
 * `PUBLIC_API_BASE_URL` is validated boot-time by `validateRequiredEnv`; an
 * empty/missing value makes `requireEnv` throw before the caller sees it.
 */
export function buildWebhookCallbackUrl(storeId: string): string {
  return buildSharedWebhookCallbackUrl(requireEnv('PUBLIC_API_BASE_URL'), storeId);
}

/** apps/api call shape — base URL injected from env, so callers omit `baseUrl`. */
export type RegisterStoreWebhookInput = Omit<RegisterStoreWebhookArgs, 'baseUrl'>;

export async function registerStoreWebhook(
  args: RegisterStoreWebhookInput,
): Promise<RegisterStoreWebhookResult> {
  return registerStoreWebhookShared({ ...args, baseUrl: requireEnv('PUBLIC_API_BASE_URL') });
}

/** apps/api call shape — base URL injected from env, so callers omit `baseUrl`. */
export type RotateStoreWebhookInput = Omit<RotateStoreWebhookArgs, 'baseUrl'>;

export async function rotateStoreWebhookSecret(
  args: RotateStoreWebhookInput,
): Promise<{ encryptedSecret: string }> {
  return rotateStoreWebhookSecretShared({ ...args, baseUrl: requireEnv('PUBLIC_API_BASE_URL') });
}
