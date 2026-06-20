/**
 * Read a required environment variable. Throws if missing or empty —
 * prefer failing fast over silently producing surprise 500s (missing
 * DATABASE_URL), 401s (missing Supabase creds), or cryptographic errors
 * (missing ENCRYPTION_KEY).
 *
 * Shared by `apps/api` (request-time boot validation) and
 * `apps/sync-worker` (worker boot validation), so it lives in
 * `@pazarsync/utils` rather than being duplicated per app.
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
