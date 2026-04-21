/**
 * In-memory shape of Trendyol API credentials. Persisted only as an
 * AES-256-GCM ciphertext (the stores.credentials JSON column holds the
 * base64 blob). Decrypt only inside an adapter, never outside the
 * request that needs it.
 */
export interface TrendyolCredentials {
  supplierId: string;
  apiKey: string;
  apiSecret: string;
}

export function isTrendyolCredentials(value: unknown): value is TrendyolCredentials {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['supplierId'] === 'string' &&
    typeof v['apiKey'] === 'string' &&
    typeof v['apiSecret'] === 'string'
  );
}
