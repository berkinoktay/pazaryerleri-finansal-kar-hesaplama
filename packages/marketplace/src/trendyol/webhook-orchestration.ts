/**
 * Trendyol webhook subscription orchestration (cross-app).
 *
 * Wraps the pure HTTP helpers in `./webhooks` with the per-store concerns both
 * `apps/api` and `apps/sync-worker` need:
 *   1. Generate cryptographically random Basic Auth credentials for the receiver
 *   2. Build the per-store callback URL
 *   3. Call Trendyol register / update / unregister
 *   4. Encrypt the receiver credentials (→ `Store.webhookSecret`)
 *
 * `buildWebhookCallbackUrl(baseUrl, storeId)` takes the base URL as a PARAMETER —
 * each consumer injects its own `PUBLIC_API_BASE_URL` (apps/api via `requireEnv`,
 * the sync-worker reconciler via `process.env`). This module reads no env, so it
 * stays a pure, reusable orchestration layer.
 *
 * Home note: this lives in `@pazarsync/marketplace` (not `@pazarsync/sync-core`)
 * because it imports the marketplace webhook HTTP helpers. `marketplace` already
 * depends on `sync-core` (for `encryptCredentials`), so placing it in `sync-core`
 * would introduce a `sync-core ⇄ marketplace` dependency cycle.
 *
 * Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §4.1, §7.4
 */

import { randomBytes } from 'node:crypto';

import type { StoreEnvironment } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';

import type { TrendyolCredentials } from './types';
import { WEBHOOK_ORDERS_PATH } from './webhook-paths';
import {
  registerTrendyolWebhook,
  unregisterTrendyolWebhook,
  updateTrendyolWebhook,
  type RegisterTrendyolWebhookOpts,
  type UnregisterTrendyolWebhookOpts,
  type UpdateTrendyolWebhookOpts,
} from './webhooks';

/**
 * Per-store webhook receiver Basic Auth credential.
 *
 * Username: deterministic prefix `pazarsync-` + 64-bit random hex (16 char) —
 *   helps quickly identify the owning store in log redactions.
 * Password: 256-bit random base64url (~43 char). URL-safe alphabet (RFC 4648 §5)
 *   so it needs no escaping in an HTTP header.
 */
export interface WebhookReceiverCredentials {
  username: string;
  password: string;
}

export function generateWebhookCredentials(): WebhookReceiverCredentials {
  return {
    username: `pazarsync-${randomBytes(8).toString('hex')}`,
    password: randomBytes(32).toString('base64url'),
  };
}

/**
 * Per-store webhook callback URL builder.
 *
 * Path = `/v1/webhooks/orders/:storeId`; one trailing slash on `baseUrl` is
 * stripped. The base URL is injected by the caller — this builder reads no env.
 */
export function buildWebhookCallbackUrl(baseUrl: string, storeId: string): string {
  return `${baseUrl.replace(/\/$/, '')}${WEBHOOK_ORDERS_PATH}${storeId}`;
}

/**
 * Convenience orchestrator: generate a random credential → Trendyol POST
 * /webhooks → return the encrypted secret blob.
 *
 * The caller writes the blob to `Store.webhookSecret` and sets `webhookId` +
 * `webhookActiveAt`. Marketplace helper errors propagate to the caller, which
 * decides the policy (connect is non-blocking; the reconciler logs + retries).
 */
export interface RegisterStoreWebhookArgs {
  storeId: string;
  /** `PUBLIC_API_BASE_URL` of the consuming app, injected (no env read here). */
  baseUrl: string;
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  /** Override default subscribedStatuses (test/special-case). */
  subscribedStatuses?: RegisterTrendyolWebhookOpts['subscribedStatuses'];
  signal?: AbortSignal;
}

export interface RegisterStoreWebhookResult {
  webhookId: string;
  encryptedSecret: string;
}

export async function registerStoreWebhook(
  args: RegisterStoreWebhookArgs,
): Promise<RegisterStoreWebhookResult> {
  const { username, password } = generateWebhookCredentials();
  const callbackUrl = buildWebhookCallbackUrl(args.baseUrl, args.storeId);

  const { webhookId } = await registerTrendyolWebhook({
    credentials: args.credentials,
    env: args.env,
    callbackUrl,
    username,
    password,
    subscribedStatuses: args.subscribedStatuses,
    signal: args.signal,
  });

  const encryptedSecret = encryptCredentials({ username, password });
  return { webhookId, encryptedSecret };
}

export interface UnregisterStoreWebhookArgs {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  webhookId: string;
  signal?: AbortSignal;
}

export async function unregisterStoreWebhook(args: UnregisterStoreWebhookArgs): Promise<void> {
  const opts: UnregisterTrendyolWebhookOpts = {
    credentials: args.credentials,
    env: args.env,
    webhookId: args.webhookId,
  };
  if (args.signal !== undefined) opts.signal = args.signal;
  await unregisterTrendyolWebhook(opts);
}

/**
 * Manual / reconciler rotation flow: generate a new random credential, Trendyol
 * PUT update, return the encrypted secret. `webhookId` stays the same — Trendyol
 * keeps its subscription UUID; only the URL + credentials change.
 */
export interface RotateStoreWebhookArgs {
  storeId: string;
  /** `PUBLIC_API_BASE_URL` of the consuming app, injected (no env read here). */
  baseUrl: string;
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  webhookId: string;
  subscribedStatuses?: UpdateTrendyolWebhookOpts['subscribedStatuses'];
  signal?: AbortSignal;
}

export async function rotateStoreWebhookSecret(
  args: RotateStoreWebhookArgs,
): Promise<{ encryptedSecret: string }> {
  const { username, password } = generateWebhookCredentials();
  const callbackUrl = buildWebhookCallbackUrl(args.baseUrl, args.storeId);

  await updateTrendyolWebhook({
    credentials: args.credentials,
    env: args.env,
    webhookId: args.webhookId,
    callbackUrl,
    username,
    password,
    subscribedStatuses: args.subscribedStatuses,
    signal: args.signal,
  });

  const encryptedSecret = encryptCredentials({ username, password });
  return { encryptedSecret };
}
