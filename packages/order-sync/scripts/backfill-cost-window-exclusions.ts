// Operator script: stamp the cost-window exclusion on a store's EXISTING orders,
// or on every active store (Faz 3E, Task 4).
//
// Purpose: historic orders predate the cost-window rule (Berkin 2026-11-03), so
// their profit figures were written without it. This walks each store's past-day,
// not-yet-excluded, non-cancelled orders and stamps the ones whose cost missed the
// order's business day -- COST_DEADLINE_MISSED, or LATE_UNCOSTED_ARRIVAL when our
// first record of the order is itself after its day closed. Each stamped order is
// enqueued for a MANUAL profit recompute in the same transaction; the sync-worker
// recompute tick then rewrites its statements as EXCLUDED. The core logic lives in
// `stampCostWindowExclusions` (packages/order-sync/src/cost-window.ts).
//
// WARNING (order profit snapshot, PR-2): orders are now priced from the cost list
// frozen in their snapshot, but this script still decides whether the cost was
// entered in time from the live cost links (`attached_at`). An order whose link
// was changed later but whose snapshot does carry a cost can therefore be wrongly,
// and irreversibly, excluded from profit. Adapt it to read the snapshot before
// running it again.
//
// Run from inside the package (connects with DATABASE_URL from the workspace-root .env):
//   cd packages/order-sync && pnpm exec tsx --env-file=../../.env scripts/backfill-cost-window-exclusions.ts --store <id> --dry-run
//   cd packages/order-sync && pnpm exec tsx --env-file=../../.env scripts/backfill-cost-window-exclusions.ts --store <id>
//   cd packages/order-sync && pnpm exec tsx --env-file=../../.env scripts/backfill-cost-window-exclusions.ts --all
// The `pnpm --filter @pazarsync/order-sync exec` form does not find the .env file.

import { prisma, type PrismaClient } from '@pazarsync/db';
import { StoreStatus } from '@pazarsync/db/enums';

import { stampCostWindowExclusions } from '../src/cost-window';

const USAGE = 'Usage: backfill-cost-window-exclusions.ts (--store <storeId> | --all) [--dry-run]';

// One store's whole backfill runs in a single interactive transaction. A large
// store scans many order chunks with a per-order cost check, so the default
// Prisma 5s timeout is far too tight -- allow the lock wait and the full walk.
const TX_MAX_WAIT_MS = 20_000;
const TX_TIMEOUT_MS = 1_800_000;

interface StoreTarget {
  readonly id: string;
  readonly organizationId: string;
}

type ParsedArgs =
  | { readonly mode: 'store'; readonly storeId: string; readonly dryRun: boolean }
  | { readonly mode: 'all'; readonly dryRun: boolean };

/** Parses the argv tail into a mode + dry-run flag, or null when invalid. */
function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const dryRun = argv.includes('--dry-run');
  const rest = argv.filter((arg) => arg !== '--dry-run');
  if (rest.length === 1 && rest[0] === '--all') {
    return { mode: 'all', dryRun };
  }
  if (rest.length === 2 && rest[0] === '--store') {
    const storeId = rest[1];
    if (storeId !== undefined && storeId.length > 0 && !storeId.startsWith('--')) {
      return { mode: 'store', storeId, dryRun };
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

  const now = new Date();
  const label = parsed.dryRun ? 'DRY RUN (no writes)' : 'LIVE RUN';
  console.log(`${label} at ${now.toISOString()}`);

  let totalCostDeadlineMissed = 0;
  let totalLateUncostedArrival = 0;
  for (const store of targets) {
    const result = await prisma.$transaction(
      (tx) =>
        stampCostWindowExclusions(tx, {
          organizationId: store.organizationId,
          storeId: store.id,
          now,
          dryRun: parsed.dryRun,
        }),
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );
    totalCostDeadlineMissed += result.costDeadlineMissed;
    totalLateUncostedArrival += result.lateUncostedArrival;
    console.log(
      `Store ${store.id}: COST_DEADLINE_MISSED ${result.costDeadlineMissed.toString()}, ` +
        `LATE_UNCOSTED_ARRIVAL ${result.lateUncostedArrival.toString()}.`,
    );
  }

  const total = totalCostDeadlineMissed + totalLateUncostedArrival;
  console.log(
    `Done: ${total.toString()} order(s) across ${targets.length.toString()} store(s) ` +
      `(COST_DEADLINE_MISSED ${totalCostDeadlineMissed.toString()}, ` +
      `LATE_UNCOSTED_ARRIVAL ${totalLateUncostedArrival.toString()}).`,
  );

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
