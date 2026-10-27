// Create a Prisma migration without `prisma migrate dev`, which is interactive
// (it needs a TTY), so agents and CI cannot drive it.
//
//   pnpm db:migration:new <snake_case_name>
//
// Replays every existing migration into a throwaway scratch database, diffs
// the result against prisma/schema.prisma, and writes the difference to
// prisma/migrations/<UTC timestamp>_<name>/migration.sql. Writes nothing when
// the schema already matches the migration history.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { buildMigrationFolderName, isValidMigrationName } from '../src/migration-tooling';
import {
  MIGRATIONS_DIR,
  deployMigrations,
  diffAgainstSchema,
  requireLocalDatabaseUrl,
  withScratchDatabase,
} from './lib/scratch-database';

const USAGE =
  'Usage: pnpm db:migration:new <snake_case_name>   (e.g. add_product_variant_status)\n' +
  'The name must be lowercase snake_case and start with a letter.';

async function main(): Promise<number> {
  // pnpm forwards a literal `--` when the caller writes `pnpm db:migration:new -- <name>`.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const name = args[0];
  if (args.length !== 1 || name === undefined || !isValidMigrationName(name)) {
    console.error(USAGE);
    return 1;
  }

  const folder = buildMigrationFolderName(name, new Date());
  const migrationDir = path.join(MIGRATIONS_DIR, folder);
  if (existsSync(migrationDir)) {
    console.error(`prisma/migrations/${folder} already exists; re-run in a second.`);
    return 1;
  }

  const diff = await withScratchDatabase(requireLocalDatabaseUrl(), async (scratchUrl) => {
    await deployMigrations(scratchUrl);
    return diffAgainstSchema(scratchUrl, 'script');
  });

  if (diff.status === 'in-sync') {
    console.log(
      'prisma/schema.prisma already matches the migration history: no migration created.',
    );
    return 0;
  }

  mkdirSync(migrationDir);
  writeFileSync(path.join(migrationDir, 'migration.sql'), `${diff.output.trimEnd()}\n`);
  console.log(`Created prisma/migrations/${folder}/migration.sql`);
  console.log(
    'Next: review the SQL and append any data backfill, apply it to the dev DB with ' +
      '`pnpm --filter @pazarsync/db exec prisma migrate deploy`, run `pnpm db:generate`, ' +
      'then `pnpm db:check-drift`.',
  );
  return 0;
}

process.exitCode = await main();
