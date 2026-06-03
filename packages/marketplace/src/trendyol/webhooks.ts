// Trendyol Webhook Subscription API — pure HTTP layer.
//
// Source-of-truth: docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/webhook/
//   - webhook-yaratma.md (POST /integration/webhook/sellers/{sellerId}/webhooks)
//   - webhook-silme.md   (DELETE /integration/webhook/sellers/{sellerId}/webhooks/{id})
//   - webhook-guncelleme.md (PUT /integration/webhook/sellers/{sellerId}/webhooks/{id})
//   - webhook-model.md   (auth + restrictions)
//
// Design: docs/plans/2026-05-20-trendyol-webhook-receiver-design.md §7.4

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';

import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const TIMEOUT_MS = 10_000;

/**
 * Status'ler webhook ile subscribe edilir (8 explicit value).
 *
 * Atlanan 5 status (UNSUPPLIED, AWAITING, UNPACKED, AT_COLLECTION_POINT, VERIFIED)
 * için subscribe ETMİYORUZ — payload ulaşırsa handler fallback (Order.status
 * DOKUNULMAZ + log warn). Liste design §2b status mapping ile aligned ve
 * Q4'te explicit karara bağlandı (webhook-model.md §subscribedStatuses).
 */
export const TRENDYOL_SUBSCRIBED_STATUSES = [
  'CREATED',
  'PICKING',
  'INVOICED',
  'SHIPPED',
  'DELIVERED',
  'UNDELIVERED',
  'CANCELLED',
  'RETURNED',
] as const;

export type TrendyolSubscribedStatus = (typeof TRENDYOL_SUBSCRIBED_STATUSES)[number];

export interface RegisterTrendyolWebhookOpts {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  /** Tam HTTPS URL (örn. https://api.pazarsync.com/v1/webhooks/orders/<storeId>) */
  callbackUrl: string;
  /** Webhook receiver Basic Auth username — service tarafından random üretilir */
  username: string;
  /** Webhook receiver Basic Auth password — service tarafından random üretilir */
  password: string;
  /** Subscribe edilecek statü listesi; default TRENDYOL_SUBSCRIBED_STATUSES */
  subscribedStatuses?: ReadonlyArray<TrendyolSubscribedStatus>;
  signal?: AbortSignal;
}

export interface UnregisterTrendyolWebhookOpts {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  /** Trendyol POST /webhooks response.id */
  webhookId: string;
  signal?: AbortSignal;
}

export interface UpdateTrendyolWebhookOpts extends RegisterTrendyolWebhookOpts {
  webhookId: string;
}

export class WebhookCallbackUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookCallbackUrlError';
  }
}

/**
 * Trendyol webhook URL filtresi: `Trendyol`, `Dolap`, `Localhost` ibareleri
 * reddedilir; HTTP reddedilir (HTTPS şart). Trendyol'a istek atmadan
 * client-side check — register fail debug daha kolay.
 */
function assertValidCallbackUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw new WebhookCallbackUrlError(`Webhook callback URL must be HTTPS, got ${url}`);
  }
  const lower = url.toLowerCase();
  for (const banned of ['trendyol', 'dolap', 'localhost']) {
    if (lower.includes(banned)) {
      throw new WebhookCallbackUrlError(
        `Webhook callback URL contains banned keyword '${banned}' (Trendyol rejects). URL: ${url}`,
      );
    }
  }
}

/**
 * POST /integration/webhook/sellers/{sellerId}/webhooks
 *
 * Response: `{ id: string }` — Trendyol'un atadığı webhook subscription UUID.
 * Caller (apps/api service) bu id'yi `Store.webhookId` kolonuna yazar.
 *
 * `authenticationType: 'BASIC_AUTHENTICATION'` — design §4 kararı.
 * Tüm subscribedStatuses'lar webhook-model.md §subscribedStatuses
 * dizinindeki geçerli enum değerlerinden olmalı.
 */
export async function registerTrendyolWebhook(
  opts: RegisterTrendyolWebhookOpts,
): Promise<{ webhookId: string }> {
  assertValidCallbackUrl(opts.callbackUrl);

  const base = baseUrlFor(opts.env);
  const url = `${base}/integration/webhook/sellers/${opts.credentials.supplierId}/webhooks`;
  const body = {
    url: opts.callbackUrl,
    username: opts.username,
    password: opts.password,
    authenticationType: 'BASIC_AUTHENTICATION' as const,
    subscribedStatuses: opts.subscribedStatuses ?? TRENDYOL_SUBSCRIBED_STATUSES,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.env);

  const parsed = (await res.json()) as { id?: string };
  if (parsed.id === undefined || parsed.id.length === 0) {
    throw new Error(
      `Trendyol webhook register response missing id field. body=${JSON.stringify(parsed)}`,
    );
  }
  return { webhookId: parsed.id };
}

/**
 * DELETE /integration/webhook/sellers/{sellerId}/webhooks/{id}
 *
 * 200 OK döner. Trendyol panel'inde webhook satırı silinir.
 * Store disconnect zincirinin parçası (apps/api storeService.disconnect).
 */
export async function unregisterTrendyolWebhook(
  opts: UnregisterTrendyolWebhookOpts,
): Promise<void> {
  const base = baseUrlFor(opts.env);
  const url = `${base}/integration/webhook/sellers/${opts.credentials.supplierId}/webhooks/${opts.webhookId}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
      },
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.env);
}

export interface ListTrendyolWebhooksOpts {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  signal?: AbortSignal;
}

/**
 * One subscription as Trendyol reports it. The reconciler consumes id + url +
 * status: `status` ('ACTIVE' | 'PASSIVE') is load-bearing — Trendyol
 * auto-deactivates a hook to PASSIVE after sustained delivery failures, and a
 * PASSIVE hook silently stops delivering, so the reconciler must heal it rather
 * than treat it as live. Absent on malformed entries.
 */
export interface TrendyolWebhookEntry {
  id: string;
  url: string;
  status?: string;
}

/**
 * GET /integration/webhook/sellers/{sellerId}/webhooks
 *
 * Lists the seller's current webhook subscriptions. The reconciler uses this to
 * detect orphaned subscriptions (point at dead storeIds) and to avoid duplicate
 * registration.
 *
 * Response is a BARE JSON ARRAY (NOT `{ content: [...] }` like the orders/products
 * endpoints) where each entry carries id/url/username/status/subscribedStatuses;
 * `lastModifiedDate` and `subscribedStatuses` may be null (webhook-listeleme.md).
 * We project to `{ id, url }` and defensively skip any entry missing either —
 * the reconciler matches on `url` and prunes by `id`, nothing else is needed.
 */
export async function getTrendyolWebhooks(
  opts: ListTrendyolWebhooksOpts,
): Promise<TrendyolWebhookEntry[]> {
  const base = baseUrlFor(opts.env);
  const url = `${base}/integration/webhook/sellers/${opts.credentials.supplierId}/webhooks`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
      },
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.env);

  const parsed = (await res.json()) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): TrendyolWebhookEntry[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const entryUrl = record['url'];
    if (typeof id !== 'string' || typeof entryUrl !== 'string') return [];
    const projected: TrendyolWebhookEntry = { id, url: entryUrl };
    const status = record['status'];
    if (typeof status === 'string') projected.status = status;
    return [projected];
  });
}

/**
 * PUT /integration/webhook/sellers/{sellerId}/webhooks/{id}
 *
 * Webhook URL veya credential güncelleme. Manual secret rotation flow için
 * (PR-C4 `POST /stores/:id/webhook/rotate-secret` endpoint'i kullanır).
 *
 * Response: 200 OK (body yok).
 */
export async function updateTrendyolWebhook(opts: UpdateTrendyolWebhookOpts): Promise<void> {
  assertValidCallbackUrl(opts.callbackUrl);

  const base = baseUrlFor(opts.env);
  const url = `${base}/integration/webhook/sellers/${opts.credentials.supplierId}/webhooks/${opts.webhookId}`;
  const body = {
    url: opts.callbackUrl,
    username: opts.username,
    password: opts.password,
    authenticationType: 'BASIC_AUTHENTICATION' as const,
    subscribedStatuses: opts.subscribedStatuses ?? TRENDYOL_SUBSCRIBED_STATUSES,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: buildAuthHeader(opts.credentials),
        'User-Agent': buildUserAgent(opts.credentials),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
  }

  if (!res.ok) mapTrendyolResponseToDomainError(res, opts.env);
}
