/**
 * Read a required env var. Throws if missing or empty — prefer failing
 * fast over silently producing surprise 500s (missing DATABASE_URL),
 * 401s (missing Supabase creds), or cryptographic errors (missing
 * ENCRYPTION_KEY).
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Required environment variable ${key} is missing. ` +
        `Local dev: check workspace-root .env (copy from .env.example). ` +
        `Deployment: verify the hosting provider's environment configuration.`,
    );
  }
  return value;
}

const ALLOWED_NODE_ENVS = ['production', 'staging', 'development', 'test'] as const;
type NodeEnv = (typeof ALLOWED_NODE_ENVS)[number];

function isNodeEnv(value: string): value is NodeEnv {
  return ALLOWED_NODE_ENVS.some((allowed) => allowed === value);
}

/**
 * Validate NODE_ENV at boot. Defense-in-depth for `apps/api/src/app.ts`,
 * which gates the OpenAPI docs surface on an explicit `development`/
 * `staging` allowlist (fail-closed against anything else).
 *
 * Asymmetric strictness:
 *   - Unset → warn only. We do NOT mutate `process.env.NODE_ENV` so the
 *     docs gate stays closed if a production deploy ever boots with the
 *     var unset (broken deploy script, forgotten platform config). Local
 *     dev still boots; the developer sees the warning and either lives
 *     with docs at /v1/docs being 404 or adds NODE_ENV=development to
 *     their .env (recommended).
 *   - Set to an unrecognised value → throw. A typo like 'prod' or
 *     'PRODUCTION' would silently flip the docs gate the wrong way, so
 *     fail-fast wins here.
 *
 * Production hosting platforms (Vercel, Render, Docker images, etc.)
 * inject NODE_ENV=production automatically, so the unset path is
 * realistically a local-dev concern.
 */
function readNodeEnv(): NodeEnv | undefined {
  const raw = process.env['NODE_ENV'];
  if (raw === undefined || raw.length === 0) {
    console.warn(
      `[env] NODE_ENV is not set. OpenAPI docs (/v1/docs, /v1/openapi.json) ` +
        `will stay off (fail-closed). To enable docs locally, add ` +
        `NODE_ENV=development to your workspace-root .env. Production ` +
        `deployments MUST set NODE_ENV=production explicitly.`,
    );
    return undefined;
  }
  if (!isNodeEnv(raw)) {
    throw new Error(
      `NODE_ENV='${raw}' is not recognised. Must be one of: ${ALLOWED_NODE_ENVS.join(', ')}. ` +
        `Common typos: 'prod' → 'production', 'dev' → 'development'.`,
    );
  }
  return raw;
}

/**
 * Fail fast at startup if any required env var is missing. Called from
 * `index.ts` before `createApp()` so misconfigured deployments surface
 * during process boot, not on the first authenticated request.
 *
 * Deliberately outside `createApp()` itself: tests that exercise the
 * factory do not need to mock every env var, and the build-time OpenAPI
 * dump script can import `createApp()` without a full env setup.
 */
export function validateRequiredEnv(): void {
  const required = [
    'DATABASE_URL',
    'ENCRYPTION_KEY',
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'TRENDYOL_PROD_BASE_URL',
    'TRENDYOL_SANDBOX_BASE_URL',
    // PR-C2: webhook receiver callback URL builder reads this to construct
    // /v1/webhooks/orders/:storeId per-store endpoint. Trendyol register
    // call rejects http://, localhost, 127.0.0.1 — see webhook design §13.
    'PUBLIC_API_BASE_URL',
  ] as const;
  for (const key of required) {
    requireEnv(key);
  }
  // NODE_ENV gets its own helper because we also validate the value, not
  // just presence — unknown modes (e.g. 'prod', 'PRODUCTION') would still
  // pass a non-empty presence check but flip the docs gate the wrong way.
  readNodeEnv();
}
