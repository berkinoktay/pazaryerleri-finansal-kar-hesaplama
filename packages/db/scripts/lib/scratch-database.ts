// I/O half of the migration tooling (scripts/create-migration.ts and
// scripts/check-migration-drift.ts): create a throwaway database on the local
// Postgres server, replay prisma/migrations into it, diff it against
// prisma/schema.prisma, and drop it again. The naming and safety rules live in
// src/migration-tooling.ts, covered by the DB-free unit suite.
//
// Same building blocks as setup-test-db.ts: `pg` for CREATE/DROP DATABASE (no
// psql dependency) and execFile for the Prisma CLI, run from packages/db with
// DATABASE_URL and DIRECT_URL overridden. prisma.config.ts loads the root .env
// through dotenv, which never overrides an already-set variable, so Prisma
// sees the override.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

import {
  buildScratchDatabaseName,
  deriveScratchDatabaseUrl,
  isLoopbackDatabaseUrl,
  isScratchDatabaseName,
} from '../../src/migration-tooling';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// packages/db: every Prisma command runs from here so prisma.config.ts is picked up.
const PACKAGE_DIR = path.resolve(__dirname, '../..');
const ROOT_ENV_FILE = path.resolve(PACKAGE_DIR, '../../.env');
const SCHEMA_PATH = 'prisma/schema.prisma';
const SCRATCH_SUFFIX_BYTES = 4;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
// `prisma migrate diff --exit-code`: 0 = no difference, 2 = difference, anything else = error.
const DIFF_EXIT_IN_SYNC = 0;
const DIFF_EXIT_CHANGED = 2;

/** Absolute path of prisma/migrations (prisma.config.ts `migrations.path`). */
export const MIGRATIONS_DIR = path.join(PACKAGE_DIR, 'prisma', 'migrations');

/** `summary` is Prisma's human-readable diff, `script` the executable SQL. */
export type SchemaDiffFormat = 'summary' | 'script';

export type SchemaDiff = { status: 'in-sync' } | { status: 'changed'; output: string };

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * DATABASE_URL of the server the scratch database is created on. Loads the
 * workspace-root .env first (an exported DATABASE_URL, as in CI, wins) and
 * refuses anything but a loopback host, because this tooling creates and
 * drops databases.
 */
export function requireLocalDatabaseUrl(): string {
  loadEnv({ path: ROOT_ENV_FILE });
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required: set it in the workspace-root .env (CI exports it).');
  }
  if (!isLoopbackDatabaseUrl(databaseUrl)) {
    throw new Error(
      'DATABASE_URL must be a valid URL of a local Postgres server (127.0.0.1, localhost or ' +
        '::1, no host query parameter): the migration tooling creates and drops scratch ' +
        'databases on it.',
    );
  }
  return databaseUrl;
}

/**
 * Run a command from packages/db. Resolves with the exit code instead of
 * rejecting on a non-zero exit, because `prisma migrate diff --exit-code`
 * reports a difference through exit code 2. Rejects only when the process
 * could not start or was killed (no numeric exit code).
 */
function runCommand(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: PACKAGE_DIR, env, encoding: 'utf8', maxBuffer: MAX_COMMAND_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === 'number') {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}

function scratchEnv(scratchUrl: string): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: scratchUrl, DIRECT_URL: scratchUrl };
}

async function createDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // CREATE DATABASE cannot be parameterized; the name is a validated scratch name, quoted anyway.
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  if (!isScratchDatabaseName(name)) {
    throw new Error(`Refusing to drop "${name}": not a scratch database name.`);
  }
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // WITH (FORCE) (Postgres 13+) also ends a connection a crashed Prisma process left open.
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

/**
 * Create a uniquely named scratch database on `adminUrl`'s server, pass its URL
 * to `work`, and drop it afterwards, also when `work` throws.
 */
export async function withScratchDatabase<T>(
  adminUrl: string,
  work: (scratchUrl: string) => Promise<T>,
): Promise<T> {
  const suffix = randomBytes(SCRATCH_SUFFIX_BYTES).toString('hex');
  const name = buildScratchDatabaseName(new Date(), suffix);
  const scratchUrl = deriveScratchDatabaseUrl(adminUrl, name);
  await createDatabase(adminUrl, name);
  console.log(`Created scratch database ${name}`);
  let result: T;
  try {
    result = await work(scratchUrl);
  } catch (error) {
    // Rethrow the work failure, not a drop failure: the drop error is only
    // logged here so it cannot hide the error that explains what went wrong.
    try {
      await dropDatabase(adminUrl, name);
      console.log(`Dropped scratch database ${name}`);
    } catch (dropError) {
      console.error(`Could not drop scratch database ${name}:`, dropError);
    }
    throw error;
  }
  await dropDatabase(adminUrl, name);
  console.log(`Dropped scratch database ${name}`);
  return result;
}

/** Apply every folder in prisma/migrations to the scratch database. */
export async function deployMigrations(scratchUrl: string): Promise<void> {
  const result = await runCommand(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy'],
    scratchEnv(scratchUrl),
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `prisma migrate deploy failed (exit ${result.exitCode}):\n${result.stdout}${result.stderr}`,
    );
  }
  console.log(result.stdout.trim());
}

/**
 * Diff the scratch database (the configured datasource) against
 * prisma/schema.prisma. The diff travels through `--output`, not stdout: with
 * `--exit-code` Prisma calls process.exit() right after printing, which can cut
 * a piped stdout off at the OS pipe buffer (64 KiB on macOS), while the output
 * file is written before Prisma exits.
 */
export async function diffAgainstSchema(
  scratchUrl: string,
  format: SchemaDiffFormat,
): Promise<SchemaDiff> {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'pazarsync-migrate-diff-'));
  const outputFile = path.join(outputDir, 'diff.txt');
  const args = [
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    SCHEMA_PATH,
    '--exit-code',
    '--output',
    outputFile,
    ...(format === 'script' ? ['--script'] : []),
  ];
  try {
    const result = await runCommand('pnpm', args, scratchEnv(scratchUrl));
    if (result.exitCode === DIFF_EXIT_IN_SYNC) {
      return { status: 'in-sync' };
    }
    if (result.exitCode === DIFF_EXIT_CHANGED) {
      return { status: 'changed', output: readFileSync(outputFile, 'utf8') };
    }
    throw new Error(
      `prisma migrate diff failed (exit ${result.exitCode}):\n${result.stdout}${result.stderr}`,
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}
