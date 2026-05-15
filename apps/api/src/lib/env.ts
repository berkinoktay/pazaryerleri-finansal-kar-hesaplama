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
 * Resolve NODE_ENV to one of the recognised modes. Defense-in-depth for
 * `apps/api/src/app.ts`, where `NODE_ENV !== 'production'` decides whether
 * to expose `/openapi.json` and the Scalar UI. An unset `NODE_ENV` would
 * otherwise satisfy that check and leak the API surface in production.
 */
function readNodeEnv(): NodeEnv {
  const raw = process.env['NODE_ENV'];
  if (raw === undefined || raw.length === 0) {
    throw new Error(
      `NODE_ENV is not set. Must be one of: ${ALLOWED_NODE_ENVS.join(', ')}. ` +
        `Local dev defaults to 'development' via the shell or .env; production ` +
        `deployments must set NODE_ENV=production explicitly so that dev-only ` +
        `surfaces (OpenAPI docs, debug logging) stay off.`,
    );
  }
  if (!isNodeEnv(raw)) {
    throw new Error(
      `NODE_ENV='${raw}' is not recognised. Must be one of: ${ALLOWED_NODE_ENVS.join(', ')}.`,
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
  ] as const;
  for (const key of required) {
    requireEnv(key);
  }
  // NODE_ENV gets its own helper because we also validate the value, not
  // just presence — unknown modes (e.g. 'prod', 'PRODUCTION') would still
  // pass a non-empty presence check but flip the docs gate the wrong way.
  readNodeEnv();
}
