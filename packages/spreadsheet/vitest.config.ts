import { defineConfig } from 'vitest/config';

import { testWorkers } from '@pazarsync/vitest-config';

export default defineConfig({
  test: {
    environment: 'node',
    // Files run one at a time: several assert wall-clock budgets (enforced in CI,
    // see tests/helpers/timing.ts) and spawn parse workers, so two files side by
    // side on a 2-vCPU runner halve each other's CPU and blow the budget. The
    // budget tests are due to move to a dedicated slow lane; until then the
    // package stays serial. maxWorkers is inert here, but importing the policy
    // still neutralizes VITEST_MAX_WORKERS.
    fileParallelism: false,
    maxWorkers: testWorkers(),
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // The gate tests time crafted inputs against loose bounds (tens of seconds) so a
    // loaded machine cannot flap them; the default 5 s test timeout would fire first.
    testTimeout: 60_000,
  },
});
