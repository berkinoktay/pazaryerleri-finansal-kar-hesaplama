// Seed the read-only fixtures every integration suite expects into the test DB
// template (`pnpm db:test-setup` runs this with DATABASE_URL = the template).
// They used to be seeded by each package's vitest globalSetup on every run;
// cloning the template now carries them into every per-worker database.
//   - shipping reference data (carriers + tariffs + Barem tiers): CI builds the
//     schema with `prisma db push`, which skips the migration seed SQL.
//   - micro-export return tiers.
import { prisma } from '../src/index';
import { ensureMicroExportReturnTiers, ensureShippingReferenceData } from '../src/test-support';

try {
  await ensureShippingReferenceData();
  await ensureMicroExportReturnTiers();
  console.log('Test fixtures seeded (shipping reference data, micro-export return tiers).');
} finally {
  await prisma.$disconnect();
}
