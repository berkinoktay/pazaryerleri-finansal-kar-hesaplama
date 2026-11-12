// Shared test-runner resource policy, imported by every vitest config in the
// monorepo (`maxWorkers: testWorkers()`).
//
// Vitest sizes its worker pool to the whole machine by default. Turbo runs one
// vitest process per package at the same time, so on a laptop the pools stack
// up and starve each other into timeouts; on a 2-vCPU CI runner the default
// collapses to a single worker. One knob controls both:
// PAZARSYNC_TEST_WORKERS (a count like "2" or a percentage like "50%").
//
// Two layers on purpose: the default here (50% locally) is right for ONE vitest
// process — an editor run or a single package. Entry points that run several
// packages at once through turbo (scripts/check-affected.sh, the root
// test:unit / check:* scripts) cap every process at 2 by exporting the knob,
// because turbo starts up to 3 of them together.
//
// VITEST_MAX_WORKERS is deliberately neutralized on import: vitest applies it
// after the config is resolved, so it would silently override `maxWorkers`
// (the integration globalSetup creates exactly one database clone per
// configured worker) and `fileParallelism: false` where a suite still needs it
// (spreadsheet time budgets, the RLS suite on the shared dev DB).
delete process.env['VITEST_MAX_WORKERS'];

// At least 1: vitest treats a maxWorkers of 0 as "unset" and falls back to one
// worker per core, which would silently undo the cap.
/**
 * Per-test timeout for DB-backed integration suites. Their tests make real
 * Postgres round-trips and real GoTrue sign-ups / sign-ins (bcrypt), and with
 * files in parallel every worker shares the one GoTrue container — a test that
 * takes ~1 s alone can pass 5 s (vitest's default) when four workers sign users
 * up at once. 15 s absorbs that contention and still fails a genuine hang.
 */
export const INTEGRATION_TEST_TIMEOUT_MS = 15_000;

const WORKER_COUNT_RE = /^[1-9]\d*$/;
const WORKER_PERCENT_RE = /^[1-9]\d*%$/;
const CI_DEFAULT_WORKERS = 2;
const LOCAL_DEFAULT_WORKERS = '50%';

export function testWorkers(): number | string {
  const raw = process.env['PAZARSYNC_TEST_WORKERS'];
  if (raw !== undefined) {
    if (WORKER_COUNT_RE.test(raw)) return Number(raw);
    if (WORKER_PERCENT_RE.test(raw)) return raw;
    throw new Error(
      `PAZARSYNC_TEST_WORKERS must be a positive worker count ("2") or percentage ("50%"), got: "${raw}"`,
    );
  }
  return isCi() ? CI_DEFAULT_WORKERS : LOCAL_DEFAULT_WORKERS;
}

// Same rule as vitest's own CI detection (std-env): an unset, empty, "false" or
// "0" CI variable means a local run.
const FALSY_CI_VALUES: ReadonlySet<string> = new Set(['', 'false', '0']);

function isCi(): boolean {
  const ci = process.env['CI'];
  return ci !== undefined && !FALSY_CI_VALUES.has(ci);
}
