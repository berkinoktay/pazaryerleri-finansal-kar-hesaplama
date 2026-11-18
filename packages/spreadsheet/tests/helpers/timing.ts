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
 * Bound for the gate reading formula fields up to MAX_FORMULA_SCAN_UNITS in the costliest
 * shapes measured: about 2.5 s alone on the owner's machine for the one NFKC keeps and
 * about 1.1 s for the one NFKC changes, where one upload of fields whose NFKC form was
 * not capped held the parse worker for 13 s, and 26 s when a part was scanned twice.
 * Tighter than LINEAR_BUDGET_MS, which would let those through.
 */
export const FORMULA_SCAN_BUDGET_MS = 10_000;

/**
 * Bound for one inflate whose output is capped by a declared size. The capped inflate
 * stops in under a millisecond where an unbounded one decodes the whole stream and
 * takes a second or more, so the gap stays wide on a loaded runner.
 */
export const BOUNDED_INFLATE_BUDGET_MS = 500;
