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
