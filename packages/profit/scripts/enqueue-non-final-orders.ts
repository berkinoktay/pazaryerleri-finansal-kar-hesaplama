// Deploy script (same-day edit window, plan PR-1 release step 6): enqueue a profit
// recompute for every NON-FINAL order of a store, or of every active store.
//
// Purpose: the migration marks every order dated before the release day final, so
// only the release day's orders (and any later non-final ones) still follow their
// business day. Each enqueued order re-derives its cost list and desi at its day end
// on the next recompute, which moves it from the old pinning to the day-end rule. A
// final order is never queued. Without this run the same happens at the first day
// close; this only makes it immediate.
//
// Dry run by default: prints each store's count of non-final orders and writes
// nothing. `--apply` enqueues them (reason MANUAL), one transaction per store, every
// read and write filtered by the store's organization and store id. Only ids and
// counts are printed, never a credential.
//
// Do not run between 23:50 and 00:15 Istanbul (day close).
//
// Run from inside the package (connects with DATABASE_URL from the workspace-root .env):
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-non-final-orders.ts --all
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-non-final-orders.ts --all --apply
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/enqueue-non-final-orders.ts --store <id> [--apply]
// The `pnpm --filter @pazarsync/profit exec` form does not find the .env file.

import { prisma, type PrismaClient } from '@pazarsync/db';
import { ProfitRecomputeReason, StoreStatus } from '@pazarsync/db/enums';

import { enqueueProfitRecomputeForNonFinalOrders } from '../src/persistence/recompute-queue';

const USAGE = 'Usage: enqueue-non-final-orders.ts (--store <storeId> | --all) [--apply]';

const APPLY_FLAG = '--apply';

interface StoreTarget {
  readonly id: string;
  readonly organizationId: string;
}

type ParsedArgs =
  | { readonly mode: 'store'; readonly storeId: string; readonly apply: boolean }
  | { readonly mode: 'all'; readonly apply: boolean };

/** Parses the argv tail into a mode + apply flag, or null when the arguments are invalid. */
function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const apply = argv.includes(APPLY_FLAG);
  const rest = argv.filter((arg) => arg !== APPLY_FLAG);
  if (rest.length === 1 && rest[0] === '--all') {
    return { mode: 'all', apply };
  }
  if (rest.length === 2 && rest[0] === '--store') {
    const storeId = rest[1];
    if (storeId !== undefined && storeId.length > 0 && !storeId.startsWith('--')) {
      return { mode: 'store', storeId, apply };
    }
  }
  return null;
}

/** Resolves the stores to process: one by id, or every ACTIVE store. */
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

/** The store's non-final orders, counted under its organization and store. */
function countNonFinalOrders(db: PrismaClient, store: StoreTarget): Promise<number> {
  return db.order.count({
    where: { organizationId: store.organizationId, storeId: store.id, sellerInputsFinalAt: null },
  });
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

  let total = 0;
  for (const store of targets) {
    if (!parsed.apply) {
      const nonFinal = await countNonFinalOrders(prisma, store);
      total += nonFinal;
      console.log(`Store ${store.id}: ${nonFinal.toString()} non-final order(s).`);
      continue;
    }
    // One transaction per store: the enqueue writes a mark for every non-final order of
    // the store (org + store filtered) and returns the count.
    const enqueued = await prisma.$transaction((tx) =>
      enqueueProfitRecomputeForNonFinalOrders(tx, {
        organizationId: store.organizationId,
        storeId: store.id,
        reason: ProfitRecomputeReason.MANUAL,
      }),
    );
    total += enqueued;
    console.log(`Store ${store.id}: enqueued ${enqueued.toString()} non-final order(s).`);
  }

  console.log(
    parsed.apply
      ? `Done: enqueued ${total.toString()} non-final order(s) across ${targets.length.toString()} store(s).`
      : `Dry run: ${total.toString()} non-final order(s) across ${targets.length.toString()} store(s). Re-run with ${APPLY_FLAG} to enqueue them.`,
  );

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
