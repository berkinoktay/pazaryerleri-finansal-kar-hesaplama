/**
 * Trendyol webhook subscription orchestration.
 *
 * Marketplace package (`@pazarsync/marketplace`) sağlar saf HTTP helper'ları:
 * `registerTrendyolWebhook` / `unregisterTrendyolWebhook` / `updateTrendyolWebhook`.
 * Bu servis orchestration katmanı:
 *   1. Per-store webhook callback URL'i `PUBLIC_API_BASE_URL` env'inden builder
 *   2. Webhook receiver için cryptographically random Basic Auth credential üret
 *   3. Trendyol register/unregister/update çağır
 *   4. Credential AES-256-GCM ile encrypt → `Store.webhookSecret` yazılır
 *
 * Caller (PR-C4'te): `storeService.connect` ve `storeService.disconnect` zinciri.
 *
 * Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §4.1, §7.4
 */

import { randomBytes } from 'node:crypto';

import {
  registerTrendyolWebhook,
  unregisterTrendyolWebhook,
  updateTrendyolWebhook,
  type RegisterTrendyolWebhookOpts,
  type TrendyolCredentials,
  type UnregisterTrendyolWebhookOpts,
  type UpdateTrendyolWebhookOpts,
} from '@pazarsync/marketplace';
import { encryptCredentials } from '@pazarsync/sync-core';
import type { StoreEnvironment } from '@pazarsync/db';

import { requireEnv } from '../../lib/env';

/**
 * Per-store webhook receiver Basic Auth credential.
 *
 * Username: deterministic prefix `pazarsync-` + 64-bit random hex (16 char).
 *   Log redaction'larda hangi store'a ait olduğunu hızlı tanımaya yardım.
 *
 * Password: 256-bit random base64url (~43 char). URL-safe karakter set
 *   (RFC 4648 §5) — HTTP header'da escape gerekmez. Brute force pratiken
 *   imkansız.
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
 * Path = `/v1/webhooks/orders/:storeId`. Trendyol register call'unda bu
 * URL'i gönderiyoruz; her store kendi path scope'unda webhook alıyor.
 *
 * `PUBLIC_API_BASE_URL` env'i `validateRequiredEnv` tarafından boot-time
 * doğrulanır — boş veya HTTPS olmayan değer → `requireEnv` fırlatır.
 * Caller'a düşmeden hata yakalanır (design §6.3).
 */
export function buildWebhookCallbackUrl(storeId: string): string {
  const base = requireEnv('PUBLIC_API_BASE_URL').replace(/\/$/, '');
  return `${base}/v1/webhooks/orders/${storeId}`;
}

/**
 * Convenience orchestrator: random credential üret → Trendyol POST /webhooks →
 * encrypted secret blob döner.
 *
 * Caller (PR-C4 `storeService.connect`) bu blob'u `Store.webhookSecret`
 * kolonuna doğrudan yazar; ayrıca `webhookId` ve `webhookActiveAt` set'ler.
 *
 * Hata akışı: marketplace helper'ı domain error fırlatırsa burada yakalanmaz —
 * caller decide eder (`storeService.connect` non-blocking warn + null bırakır;
 * `rotate-secret` endpoint 5xx döndürür).
 */
export interface RegisterStoreWebhookArgs {
  storeId: string;
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  /** Override default subscribedStatuses (test/special-case için) */
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
  const callbackUrl = buildWebhookCallbackUrl(args.storeId);

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
 * Manual rotation flow için (PR-C4 endpoint'i): yeni random credential üret,
 * Trendyol PUT update çağır, encrypted secret döner.
 *
 * `webhookId` aynı kalır — Trendyol kendi subscription UUID'sini saklar. Sadece
 * URL + credentials güncellenir. Eski secret artık reddedilir (~immediate).
 */
export interface RotateStoreWebhookArgs {
  storeId: string;
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
  const callbackUrl = buildWebhookCallbackUrl(args.storeId);

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
