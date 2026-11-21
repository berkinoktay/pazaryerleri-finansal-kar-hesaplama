// Operator script: drain the profit recompute queue locally, round after round.
//
// Purpose: after `enqueue-profit-recompute.ts` marked a store (or every active store)
// for recompute, rewrite the statements now instead of waiting for the sync-worker
// tick, e.g. to take a profit baseline before and after an engine change. Each round
// is one drainProfitRecomputeQueue pass with the worker's batch size; the script stops
// when a round claims nothing (no due mark left) or after --max-rounds rounds. A mark
// that fails is backed off by the drain itself (at least 30 s, doubling), so it is not
// re-claimed right away and cannot keep the loop alive.
//
// The sync-worker must be stopped first: the claim uses FOR UPDATE SKIP LOCKED, so the
// two would not corrupt each other, but they would split the queue and the counts this
// script prints would be meaningless. The script refuses to touch the database until
// the operator confirms that with --confirm-worker-stopped.
//
// Only counts are printed: no order id, error text, credential or order content.
//
// Run from inside the package (connects with DATABASE_URL from the workspace-root .env):
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/drain-profit-recompute.ts --confirm-worker-stopped
//   cd packages/profit && pnpm exec tsx --env-file=../../.env scripts/drain-profit-recompute.ts --confirm-worker-stopped --max-rounds 10
// The `pnpm --filter @pazarsync/profit exec` form does not find the .env file.

import { prisma } from '@pazarsync/db';

import { drainProfitRecomputeQueue, type DrainResult } from '../src/persistence/recompute-queue';

const USAGE =
  'Usage: drain-profit-recompute.ts --confirm-worker-stopped [--max-rounds <positive integer>]';

const WORKER_NOT_CONFIRMED_MESSAGE =
  'Refusing to drain: stop the sync-worker first (it drains the same queue), then re-run ' +
  'with --confirm-worker-stopped. Nothing was read or written.';

const CONFIRM_FLAG = '--confirm-worker-stopped';
const MAX_ROUNDS_FLAG = '--max-rounds';

/** Mirrors the sync-worker's PROFIT_RECOMPUTE_BATCH_SIZE (a package cannot import an app). */
const DRAIN_BATCH_SIZE = 50;

/** The round cap when --max-rounds is not given. */
const DEFAULT_MAX_ROUNDS = 1000;

interface ParsedArgs {
  readonly confirmWorkerStopped: boolean;
  readonly maxRounds: number;
}

/** Parses a positive integer flag value, or null when it is not one. */
function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Parses the argv tail (flags in any order), or null when the arguments are invalid. */
function parseArgs(argv: readonly string[]): ParsedArgs | null {
  let confirmWorkerStopped = false;
  let maxRounds: number | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === CONFIRM_FLAG && !confirmWorkerStopped) {
      confirmWorkerStopped = true;
      continue;
    }
    if (arg === MAX_ROUNDS_FLAG && maxRounds === null) {
      maxRounds = parsePositiveInteger(argv[index + 1]);
      if (maxRounds === null) {
        return null;
      }
      index += 1;
      continue;
    }
    return null;
  }
  return { confirmWorkerStopped, maxRounds: maxRounds ?? DEFAULT_MAX_ROUNDS };
}

/** The marks a round claimed that ended neither computed, failed nor unsupported. */
function goneCount(result: DrainResult): number {
  return result.claimed - result.changed - result.unchanged - result.failed - result.unsupported;
}

/** One line of counts for a round or for the run's totals. */
function formatCounts(result: DrainResult): string {
  const succeeded = result.changed + result.unchanged;
  return (
    `claimed ${result.claimed.toString()}, ` +
    `succeeded ${succeeded.toString()} (changed ${result.changed.toString()}, ` +
    `unchanged ${result.unchanged.toString()}), ` +
    `failed ${result.failed.toString()}, ` +
    `unsupported ${result.unsupported.toString()}, ` +
    `order gone ${goneCount(result).toString()}`
  );
}

/** Adds one round to the run's running total (failed order ids are not kept). */
function addRound(total: DrainResult, round: DrainResult): DrainResult {
  return {
    claimed: total.claimed + round.claimed,
    changed: total.changed + round.changed,
    unchanged: total.unchanged + round.unchanged,
    failed: total.failed + round.failed,
    unsupported: total.unsupported + round.unsupported,
    failedOrderIds: [],
  };
}

const EMPTY_TOTAL: DrainResult = {
  claimed: 0,
  changed: 0,
  unchanged: 0,
  failed: 0,
  unsupported: 0,
  failedOrderIds: [],
};

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!parsed.confirmWorkerStopped) {
    console.error(WORKER_NOT_CONFIRMED_MESSAGE);
    console.error(USAGE);
    process.exit(1);
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error(
      'DATABASE_URL is not set. Run with --env-file=../../.env from packages/profit (see the header).',
    );
    process.exit(1);
  }

  let total = EMPTY_TOTAL;
  let rounds = 0;
  let ranDry = false;
  while (rounds < parsed.maxRounds) {
    const round = await drainProfitRecomputeQueue(prisma, { batchSize: DRAIN_BATCH_SIZE });
    rounds += 1;
    console.log(`Round ${rounds.toString()}: ${formatCounts(round)}.`);
    total = addRound(total, round);
    if (round.claimed === 0) {
      ranDry = true;
      break;
    }
  }

  console.log(
    ranDry
      ? `Stopped: no due mark left after ${rounds.toString()} round(s).`
      : `Stopped: reached --max-rounds ${parsed.maxRounds.toString()}; due marks may remain.`,
  );
  console.log(`Total: ${formatCounts(total)}.`);

  // A global ops count over the whole queue, like the drain's claim itself, so it has
  // no organization filter; only the row counts are read.
  const remaining = await prisma.profitRecomputeRequest.count();
  const remainingWithFailures = await prisma.profitRecomputeRequest.count({
    where: { attempts: { gt: 0 } },
  });
  console.log(
    `Queue: ${remaining.toString()} row(s) remain, ` +
      `${remainingWithFailures.toString()} of them with at least one failed attempt.`,
  );

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
