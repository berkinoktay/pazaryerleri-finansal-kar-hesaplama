// Operator script: enqueue a profit recompute for a whole store, or for every
// active store.
//
// Purpose: after a reference-data correction (a commission rate, a fee definition,
// a shipping tariff, an fx backfill) that invalidates already-written statements,
// and for the phase 3D migration backfill, re-run the profit engine over a store's
// orders. Each store's orders are marked MANUAL in one transaction; the sync-worker
// recompute tick then drains the marks and rewrites the statements.
//
// Run from inside the package (connects with DATABASE_URL from the workspace-root .env):
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-profit-recompute.ts --store <id>
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-profit-recompute.ts --all
// The `pnpm --filter @pazarsync/profit exec` form does not find the .env file.

import { prisma, type PrismaClient } from '@pazarsync/db';
import { ProfitRecomputeReason, StoreStatus } from '@pazarsync/db/enums';

import { enqueueProfitRecomputeForStore } from '../src/persistence/recompute-queue';

const USAGE = 'Usage: enqueue-profit-recompute.ts (--store <storeId> | --all)';

interface StoreTarget {
  readonly id: string;
  readonly organizationId: string;
}

type ParsedArgs = { readonly mode: 'store'; readonly storeId: string } | { readonly mode: 'all' };

/** Parses the argv tail into a mode, or null when the arguments are invalid. */
function parseArgs(argv: readonly string[]): ParsedArgs | null {
  if (argv.length === 1 && argv[0] === '--all') {
    return { mode: 'all' };
  }
  if (argv.length === 2 && argv[0] === '--store') {
    const storeId = argv[1];
    if (storeId !== undefined && storeId.length > 0 && !storeId.startsWith('--')) {
      return { mode: 'store', storeId };
    }
  }
  return null;
}

/** Resolves the stores to enqueue: one by id, or every ACTIVE store. */
async function resolveTargets(db: PrismaClient, parsed: ParsedArgs): Promise<StoreTarget[]> {
  if (parsed.mode === 'all') {
    return db.store.findMany({
      where: { status: StoreStatus.ACTIVE },
      select: { id: true, organizationId: true },
      orderBy: { id: 'asc' },
    });
  }
  const store = await db.store.findUnique({
    where: { id: parsed.storeId },
    select: { id: true, organizationId: true },
  });
  return store === null ? [] : [store];
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) {
    console.error(USAGE);
    process.exit(1);
  }

  const targets = await resolveTargets(prisma, parsed);
  if (targets.length === 0) {
    console.error(
      parsed.mode === 'store'
        ? `No store found with id ${parsed.storeId}.`
        : 'No ACTIVE store found.',
    );
    process.exit(1);
  }

  let totalOrders = 0;
  for (const store of targets) {
    // One transaction per store: enqueueProfitRecomputeForStore writes a mark for
    // every order of the store (org + store filtered) and returns the count.
    const enqueued = await prisma.$transaction((tx) =>
      enqueueProfitRecomputeForStore(tx, {
        organizationId: store.organizationId,
        storeId: store.id,
        reason: ProfitRecomputeReason.MANUAL,
      }),
    );
    totalOrders += enqueued;
    console.log(`Store ${store.id}: enqueued ${enqueued.toString()} order(s).`);
  }

  console.log(
    `Done: enqueued ${totalOrders.toString()} order(s) across ${targets.length.toString()} store(s).`,
  );

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
