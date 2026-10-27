// Pure rules behind the migration tooling (scripts/create-migration.ts and
// scripts/check-migration-drift.ts): migration folder naming, scratch database
// naming, and the guards in front of CREATE/DROP DATABASE. No I/O here, so the
// DB-free unit suite (vitest.unit.config.ts) covers every rule; the I/O half
// lives in scripts/lib/scratch-database.ts.

/** Every scratch database name starts with this; the tooling never drops anything else. */
export const SCRATCH_DATABASE_PREFIX = 'pazarsync_scratch';

// Prisma migration folder suffix: lowercase snake_case that starts with a letter.
const MIGRATION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const SCRATCH_SUFFIX_PATTERN = /^[a-z0-9]{1,16}$/;
// <prefix>_<YYYYMMDDHHMMSS>_<suffix>: exactly what buildScratchDatabaseName returns.
const SCRATCH_DATABASE_NAME_PATTERN = new RegExp(
  `^${SCRATCH_DATABASE_PREFIX}_\\d{14}_[a-z0-9]{1,16}$`,
);
// Hosts a DATABASE_URL may name before the tooling creates or drops a database on it.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
// pg's connection-string parser lets this query parameter override the URL host.
const PG_HOST_OVERRIDE_PARAM = 'host';
const TIMESTAMP_PART_WIDTH = 2;

function pad(value: number): string {
  return String(value).padStart(TIMESTAMP_PART_WIDTH, '0');
}

export function isValidMigrationName(name: string): boolean {
  return MIGRATION_NAME_PATTERN.test(name);
}

/** `date` in UTC as YYYYMMDDHHMMSS, the timestamp format of Prisma migration folders. */
export function formatMigrationTimestamp(date: Date): string {
  return [
    String(date.getUTCFullYear()),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

/** `<UTC timestamp>_<name>`. Prisma applies migration folders in lexicographic order. */
export function buildMigrationFolderName(name: string, date: Date): string {
  if (!isValidMigrationName(name)) {
    throw new Error(
      `Invalid migration name "${name}": use lowercase snake_case that starts with a letter.`,
    );
  }
  return `${formatMigrationTimestamp(date)}_${name}`;
}

/**
 * Unique, identifier-safe name for a throwaway database. The caller passes the
 * random suffix so the result stays deterministic under test.
 */
export function buildScratchDatabaseName(date: Date, suffix: string): string {
  if (!SCRATCH_SUFFIX_PATTERN.test(suffix)) {
    throw new Error(
      `Invalid scratch database suffix "${suffix}": expected 1 to 16 lowercase letters or digits.`,
    );
  }
  return `${SCRATCH_DATABASE_PREFIX}_${formatMigrationTimestamp(date)}_${suffix}`;
}

/** True only for names buildScratchDatabaseName returns: the guard in front of DROP DATABASE. */
export function isScratchDatabaseName(name: string): boolean {
  return SCRATCH_DATABASE_NAME_PATTERN.test(name);
}

/** `baseUrl` with only its database name swapped for the scratch database. */
export function deriveScratchDatabaseUrl(baseUrl: string, databaseName: string): string {
  if (!isScratchDatabaseName(databaseName)) {
    throw new Error(`Refusing to target "${databaseName}": not a scratch database name.`);
  }
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * The tooling creates and drops databases, so it only ever talks to a local
 * server. Fails closed: a malformed URL is not loopback, so its text (which may
 * carry a password) never reaches a URL parse error.
 */
export function isLoopbackDatabaseUrl(databaseUrl: string): boolean {
  if (!URL.canParse(databaseUrl)) {
    return false;
  }
  const url = new URL(databaseUrl);
  return LOOPBACK_HOSTS.has(url.hostname) && !url.searchParams.has(PG_HOST_OVERRIDE_PARAM);
}
