// Shared HTTP header construction for Trendyol Partner API.
//
// Source-of-truth for header contract:
//   docs/integrations/trendyol/2-authorization.md
//
// Both `Authorization` and `User-Agent` are required on every request.
// Missing User-Agent → 403; missing/wrong Authorization → 401. The
// integrator suffix in the User-Agent must be alphanumeric, max 30
// chars per the spec — we validate `TRENDYOL_INTEGRATOR_UA_SUFFIX`
// at use site so a misconfigured deploy fails loud (clear error)
// rather than silent (Trendyol returns 403).

import type { StoreEnvironment } from '@pazarsync/db/enums';

import type { TrendyolCredentials } from './types';

/**
 * Per docs/integrations/trendyol/2-authorization.md:
 *   "Entegratör firma ismi alfanumerik karakterlerle maksimum 30
 *    karakter uzunluğunda gönderilmelidir."
 */
const UA_SUFFIX_PATTERN = /^[A-Za-z0-9]{1,30}$/;

export function buildAuthHeader(cred: TrendyolCredentials): string {
  const token = Buffer.from(`${cred.apiKey}:${cred.apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

export function buildUserAgent(cred: TrendyolCredentials): string {
  const suffix = process.env['TRENDYOL_INTEGRATOR_UA_SUFFIX'] ?? 'SelfIntegration';
  if (!UA_SUFFIX_PATTERN.test(suffix)) {
    throw new Error(
      `TRENDYOL_INTEGRATOR_UA_SUFFIX must be alphanumeric and 1–30 characters per Trendyol's User-Agent contract; got ${JSON.stringify(suffix)}`,
    );
  }
  return `${cred.supplierId} - ${suffix}`;
}

export function baseUrlFor(env: StoreEnvironment): string {
  const url =
    env === 'PRODUCTION'
      ? process.env['TRENDYOL_PROD_BASE_URL']
      : process.env['TRENDYOL_SANDBOX_BASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(`Trendyol base URL not configured for environment ${env}`);
  }
  return url;
}
