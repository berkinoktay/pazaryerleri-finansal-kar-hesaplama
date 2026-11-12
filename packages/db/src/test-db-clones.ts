// vitest globalSetup for integration suites (wired by configureWorkerDatabases).
// Runs once in the main process: clones the isolated test DB template into one
// private database per worker (`<template>_<prefix>_w<N>`), so files never share
// rows and can run in parallel. Postgres copies the template's files, which
// takes well under a second per clone for this schema.
//
// It never connects to the template itself (a connected template cannot be
// cloned; setup-test-db.ts also seals it with ALLOW_CONNECTIONS false) and it
// only ever drops databases whose names match this package's clone pattern.
import pg from 'pg';
import type { TestProject } from 'vitest/node';

import { templateComment } from './test-db-template';
import {
  TEST_BASE_URL_ENV,
  TEST_DB_PREFIX_ENV,
  adminDatabaseUrl,
  cloneNamePattern,
  extractDbName,
  templateDatabaseUrl,
  workerDatabaseUrl,
} from './test-env';

/** Set to 1 to keep the clones after the run (to inspect a failure). */
const KEEP_CLONES_ENV = 'PAZARSYNC_KEEP_TEST_DBS';
const SETUP_HINT = 'Run `pnpm db:test-setup` to (re)build the test DB template.';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `test-db-clones: ${name} is not set — wire the config with configureWorkerDatabases().`,
    );
  }
  return value;
}

async function withAdmin<T>(serverUrl: string, run: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: adminDatabaseUrl(serverUrl) });
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

async function assertTemplateIsCurrent(admin: pg.Client, templateName: string): Promise<void> {
  const { rows } = await admin.query<{ comment: string | null }>(
    `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`,
    [templateName],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Test DB template "${templateName}" does not exist. ${SETUP_HINT}`);
  }
  if (row.comment !== templateComment()) {
    throw new Error(
      `Test DB template "${templateName}" is out of date: the schema, the supabase/sql files or the ` +
        `reference seeders changed since it was built. ${SETUP_HINT}`,
    );
  }
}

async function dropClones(admin: pg.Client, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(name)} WITH (FORCE)`);
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const baseUrl = requireEnv(TEST_BASE_URL_ENV);
  const prefix = requireEnv(TEST_DB_PREFIX_ENV);
  const templateName = extractDbName(templateDatabaseUrl(baseUrl));
  const workerCount = project.config.maxWorkers;

  const pattern = cloneNamePattern(extractDbName(baseUrl), prefix);
  const cloneNames = Array.from({ length: workerCount }, (_, index) =>
    extractDbName(workerDatabaseUrl(baseUrl, prefix, String(index + 1))),
  );
  for (const name of cloneNames) {
    if (!pattern.test(name))
      throw new Error(`test-db-clones: refusing unexpected database name "${name}".`);
  }

  await withAdmin(baseUrl, async (admin) => {
    await assertTemplateIsCurrent(admin, templateName);
    await dropClones(admin, cloneNames);
    for (const name of cloneNames) {
      try {
        await admin.query(
          `CREATE DATABASE ${admin.escapeIdentifier(name)} TEMPLATE ${admin.escapeIdentifier(templateName)}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Could not clone "${templateName}" into "${name}": ${reason}. ` +
            `A session connected to the template blocks cloning — close it (psql, Prisma Studio, a stuck test run). ${SETUP_HINT}`,
        );
      }
    }
  });

  return async function teardown(): Promise<void> {
    if (process.env[KEEP_CLONES_ENV] === '1') return;
    await withAdmin(baseUrl, (admin) => dropClones(admin, cloneNames));
  };
}
