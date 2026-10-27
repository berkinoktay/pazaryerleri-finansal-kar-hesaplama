// Fail when prisma/migrations no longer rebuilds prisma/schema.prisma.
//
//   pnpm db:check-drift
//
// CI and the integration-test DB apply the schema with `prisma db push`, which
// never reads the migration history, so a schema change that ships without a
// migration stays invisible until a production `prisma migrate deploy` builds
// an incomplete database. This replays every migration into a throwaway
// scratch database and diffs it against the schema: exit 0 when they match,
// exit 1 with Prisma's summary of the difference when they do not. Runs in CI
// right after `pnpm db:push` and at the end of `pnpm check:full`.

import {
  deployMigrations,
  diffAgainstSchema,
  requireLocalDatabaseUrl,
  withScratchDatabase,
} from './lib/scratch-database';

async function main(): Promise<number> {
  const diff = await withScratchDatabase(requireLocalDatabaseUrl(), async (scratchUrl) => {
    await deployMigrations(scratchUrl);
    return diffAgainstSchema(scratchUrl, 'summary');
  });

  if (diff.status === 'in-sync') {
    console.log('Migration history matches prisma/schema.prisma: no drift.');
    return 0;
  }

  console.error(
    'Migration drift: replaying prisma/migrations does not rebuild prisma/schema.prisma.\n' +
      'Changes the next migration must contain:\n',
  );
  console.error(diff.output.trimEnd());
  console.error(
    '\nFix: run `pnpm db:migration:new <snake_case_name>`, review the generated SQL and ' +
      'commit it together with the schema change.',
  );
  return 1;
}

process.exitCode = await main();
