import { expect } from 'vitest';

// Wall-clock budgets are enforced in CI only. On the owner's machine `pnpm check:all`
// runs every package's suites in parallel next to other work: a gate pass that takes
// 1.8 s alone took 55 s there (load average 46), so no budget is both tight enough to
// catch a quadratic regression and loose enough to stay green. Locally the work still
// runs and its outcome is still asserted, and the test timeout still stops a pass that
// never ends.
const ENFORCE_TIME_BUDGETS = process.env.CI === 'true';

/** Asserts `elapsedMs` is under `budgetMs` in CI; a no-op locally (see above). */
export function expectWithinBudget(elapsedMs: number, budgetMs: number): void {
  if (!ENFORCE_TIME_BUDGETS) return;
  expect(elapsedMs).toBeLessThan(budgetMs);
}

/**
 * Bound for a linear pass over the largest crafted input of a test. Loose on purpose
 * (CI runs suites side by side); the regressions it guards against are quadratic or
 * allocation blow-ups that take minutes or crash, so tens of seconds still separate them.
 */
export const LINEAR_BUDGET_MS = 20_000;

/**
 * Bound for one inflate whose output is capped by a declared size. The capped inflate
 * stops in under a millisecond where an unbounded one decodes the whole stream and
 * takes a second or more, so the gap stays wide on a loaded runner.
 */
export const BOUNDED_INFLATE_BUDGET_MS = 500;
