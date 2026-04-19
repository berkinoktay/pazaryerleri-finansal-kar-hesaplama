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
  ] as const;
  for (const key of required) {
    requireEnv(key);
  }
}
