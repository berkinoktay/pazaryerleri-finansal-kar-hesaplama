# PR #1 — Sync Observability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `apps/sync-worker` into `pnpm dev`, add a tiny structured logger to `packages/sync-core`, and instrument every state transition in the sync engine (acquireSlot, claim, run, chunk, tick, retry, fail, complete, shutdown, watchdog reap) so failures are debuggable without guesswork.

**Architecture:** A single `syncLog` module in `@pazarsync/sync-core` exposes `info` / `warn` / `error` methods. JSON output when `NODE_ENV=production`, pretty (`· event key=val`) otherwise. Three runtime callers (`packages/sync-core/sync-log.service.ts`, `apps/sync-worker/src/index.ts` + handler, `apps/api/src/routes/product.routes.ts`) replace `console.log`/`console.error` with structured calls.

**Tech Stack:** TypeScript 6, Vitest 4, Hono 4, Prisma 7, Node 20+. No new runtime deps.

**Companion docs:**
- Spec / scope: [`2026-04-28-sync-engine-completion-execution.md`](./2026-04-28-sync-engine-completion-execution.md)
- Technical detail per task: [`2026-04-28-sync-engine-completion-handoff.md`](./2026-04-28-sync-engine-completion-handoff.md) §C

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `packages/sync-core/src/logger.ts` | **Create** | Structured logger primitive — single `emit` + three named helpers |
| `packages/sync-core/src/logger.test.ts` | **Create** | Unit tests for logger (prod JSON / dev pretty / undefined-value filter) |
| `packages/sync-core/src/index.ts` | Modify | Re-export `syncLog` and `LogContext` |
| `packages/sync-core/src/sync-log.service.ts` | Modify | Add log call inside each lifecycle function |
| `apps/sync-worker/src/index.ts` | Modify | Replace `console.log/error` with `syncLog`, add idle/run/watchdog-reaped logs |
| `apps/sync-worker/src/handlers/products.ts` | Modify | Add `chunk.start` / `chunk.complete`; replace `[product-sync] content-upsert failed` `console.error` |
| `apps/api/src/routes/product.routes.ts` | Modify | Add `trigger.enqueued` after `acquireSlot` |
| `docs/audits/2026-04-28-sync-plan-audit.md` | Add (existing untracked file) | Bundle audit into PR for reviewer context |
| `docs/plans/2026-04-28-sync-engine-completion-handoff.md` | Add (existing untracked file) | Bundle handoff into PR for reviewer context |
| `docs/plans/2026-04-28-sync-engine-completion-execution.md` | Add (existing untracked file) | Bundle execution spec into PR for reviewer context |

---

## Task 0: Branch + bundle the planning docs

**Files:**
- Branch: `feat/sync-observability` off `main`
- Add: `docs/audits/2026-04-28-sync-plan-audit.md`, `docs/plans/2026-04-28-sync-engine-completion-handoff.md`, `docs/plans/2026-04-28-sync-engine-completion-execution.md`, `docs/plans/2026-04-28-pr1-sync-observability-plan.md`

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
git checkout -b feat/sync-observability
git status
```

Expected: `On branch feat/sync-observability`, untracked `docs/audits/`, `docs/plans/2026-04-28-*.md`.

- [ ] **Step 2: Stage docs**

```bash
git add docs/audits/2026-04-28-sync-plan-audit.md \
        docs/plans/2026-04-28-sync-engine-completion-handoff.md \
        docs/plans/2026-04-28-sync-engine-completion-execution.md \
        docs/plans/2026-04-28-pr1-sync-observability-plan.md
git status
```

Expected: 4 files in "Changes to be committed".

- [ ] **Step 3: Commit (ASK USER FIRST)**

Project memory rule: never `git commit` without explicit user approval, even in continuous mode. Pause and ask: "Ready to commit the four planning docs as `docs(sync): add audit, handoff, execution spec, PR #1 plan`?"

After approval:

```bash
git commit -m "$(cat <<'EOF'
docs(sync): add audit, handoff, execution spec, PR #1 plan

Bundle the four planning docs that drive the v2 sync-engine completion
work into the first PR so reviewers have full context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/sync-observability <hash>] docs(sync): …` with 4 files changed.

---

## Task 1: Logger module (TDD)

**Files:**
- Create: `packages/sync-core/src/logger.ts`
- Create: `packages/sync-core/src/logger.test.ts`
- Modify: `packages/sync-core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sync-core/src/logger.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncLog } from './logger';

describe('syncLog', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  it('emits a single JSON line in production', () => {
    process.env['NODE_ENV'] = 'production';
    syncLog.info('test.event', { workerId: 'w1', count: 3 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]![0] as string;
    const parsed: Record<string, unknown> = JSON.parse(arg);
    expect(parsed).toMatchObject({
      level: 'info',
      event: 'test.event',
      workerId: 'w1',
      count: 3,
    });
    expect(typeof parsed['timestamp']).toBe('string');
  });

  it('uses pretty format with · prefix for info in non-production', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.starting', { workerId: 'w-abc' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] worker.starting workerId=w-abc');
  });

  it('uses ! prefix for warn', () => {
    delete process.env['NODE_ENV'];
    syncLog.warn('sync.retryable', { syncLogId: 'abc', attemptCount: 2 });
    expect(logSpy.mock.calls[0]![0]).toBe(
      '! [sync] sync.retryable syncLogId=abc attemptCount=2',
    );
  });

  it('uses ✗ prefix for error', () => {
    delete process.env['NODE_ENV'];
    syncLog.error('sync.failed', { syncLogId: 'x' });
    expect(logSpy.mock.calls[0]![0]).toBe('✗ [sync] sync.failed syncLogId=x');
  });

  it('handles empty context', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('worker.stopped');
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] worker.stopped');
  });

  it('drops undefined values from pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('event', { a: 'kept', b: undefined, c: 7 });
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] event a=kept c=7');
  });

  it('JSON.stringifies nested objects in pretty output', () => {
    delete process.env['NODE_ENV'];
    syncLog.info('chunk.start', { cursor: { kind: 'page', n: 3 } });
    expect(logSpy.mock.calls[0]![0]).toBe('· [sync] chunk.start cursor={"kind":"page","n":3}');
  });
});
```

- [ ] **Step 2: Run test, verify fail**

```bash
pnpm --filter @pazarsync/sync-core test:unit -- logger
```

Expected: `Cannot find module './logger'` or `Failed to resolve import './logger'` — file doesn't exist yet.

- [ ] **Step 3: Implement the logger**

Create `packages/sync-core/src/logger.ts`:

```ts
// Tiny structured logger for the sync engine. Uses console.log
// (Hono and the worker both write to stdout in dev/prod). Formats as
// JSON when NODE_ENV=production, pretty-prints otherwise. No deps.

export interface LogContext {
  syncLogId?: string;
  storeId?: string;
  organizationId?: string;
  syncType?: string;
  workerId?: string;
  [key: string]: unknown;
}

export type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  if (process.env['NODE_ENV'] === 'production') {
    const record = { timestamp: new Date().toISOString(), level, event, ...ctx };
    console.log(JSON.stringify(record));
    return;
  }
  const prefix = level === 'error' ? '✗' : level === 'warn' ? '!' : '·';
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  console.log(`${prefix} [sync] ${event}${ctxStr.length > 0 ? ' ' + ctxStr : ''}`);
}

export const syncLog = {
  info: (event: string, ctx?: LogContext): void => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext): void => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext): void => emit('error', event, ctx),
};
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm --filter @pazarsync/sync-core test:unit -- logger
```

Expected: `7 passed`.

- [ ] **Step 5: Re-export from sync-core index**

Edit `packages/sync-core/src/index.ts` — add the export below `export * as syncLogService …`:

```ts
export * from './checkpoint';
export * from './errors';
export {
  EncryptionKeyError,
  decrypt,
  decryptCredentials,
  encrypt,
  encryptCredentials,
  loadEncryptionKey,
} from './crypto';
export { mapPrismaError } from './map-prisma-error';
export * as syncLogService from './sync-log.service';
export { markRetryable } from './sync-log.service';
export { tryClaimNext } from './claim';
export { syncLog, type LogContext, type LogLevel } from './logger';
```

- [ ] **Step 6: Typecheck the whole monorepo**

```bash
pnpm typecheck
```

Expected: all packages pass. The new export is unused at this point but typecheck must be clean.

- [ ] **Step 7: Commit (ASK USER FIRST)**

Ask: "Ready to commit Task 1 as `feat(sync-core): add structured logger`?"

```bash
git add packages/sync-core/src/logger.ts \
        packages/sync-core/src/logger.test.ts \
        packages/sync-core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(sync-core): add structured logger

Adds a tiny zero-dep logger primitive used across the sync engine.
Pretty-prints in dev (· event key=val), one JSON line per call in
production. Re-exported from @pazarsync/sync-core.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: 3 files changed.

---

## Task 2: Instrument `sync-log.service.ts`

**Files:**
- Modify: `packages/sync-core/src/sync-log.service.ts`

The handoff §C.2 prescribes a log line per lifecycle function. Each function gets one `syncLog` call ABOVE the prisma write so the log is emitted even if the write throws.

- [ ] **Step 1: Add the import**

Edit `packages/sync-core/src/sync-log.service.ts` — change the import block at the top:

```ts
import { prisma } from '@pazarsync/db';
import type { SyncLog, SyncType } from '@pazarsync/db';

import { NotFoundError, SyncInProgressError } from './errors';
import { syncLog } from './logger';
```

- [ ] **Step 2: Instrument `acquireSlot`**

Replace the body of `acquireSlot` (currently lines 66–99). The new version logs `slot.acquire.attempt` before the insert and `slot.conflict` in the conflict branch (with `existingSyncLogId` once known):

```ts
export async function acquireSlot(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog> {
  syncLog.info('slot.acquire.attempt', { organizationId, storeId, syncType });
  try {
    const created = await prisma.syncLog.create({
      data: {
        organizationId,
        storeId,
        syncType,
        status: 'PENDING',
        startedAt: new Date(),
      },
    });
    syncLog.info('slot.acquired', {
      organizationId,
      storeId,
      syncType,
      syncLogId: created.id,
    });
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await prisma.syncLog.findFirst({
        where: {
          storeId,
          syncType,
          status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
        },
        select: { id: true },
      });
      syncLog.warn('slot.conflict', {
        organizationId,
        storeId,
        syncType,
        existingSyncLogId: existing?.id,
      });
      throw new SyncInProgressError({
        syncType,
        storeId,
        existingSyncLogId: existing?.id,
      });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Instrument `tick`**

Replace the body of `tick` (currently lines 224–235):

```ts
export async function tick(syncLogId: string, input: TickInput): Promise<void> {
  syncLog.info('chunk.tick', {
    syncLogId,
    progress: input.progress,
    total: input.total,
    stage: input.stage,
    cursor: input.cursor,
  });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      lastTickAt: new Date(),
      pageCursor: input.cursor as never,
      progressCurrent: input.progress,
      progressTotal: input.total,
      progressStage: input.stage,
    },
  });
}
```

- [ ] **Step 4: Instrument `complete`**

Replace `complete` (currently lines 27–37):

```ts
export async function complete(id: string, syncedCount: number): Promise<void> {
  syncLog.info('sync.completed', { syncLogId: id, finalCount: syncedCount });
  await prisma.syncLog.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      recordsProcessed: syncedCount,
      progressCurrent: syncedCount,
    },
  });
}
```

- [ ] **Step 5: Instrument `fail`**

Replace `fail` (currently lines 39–49):

```ts
export async function fail(id: string, errorCode: string, errorMessage: string): Promise<void> {
  syncLog.error('sync.failed', { syncLogId: id, errorCode, errorMessage });
  await prisma.syncLog.update({
    where: { id },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorCode,
      errorMessage,
    },
  });
}
```

- [ ] **Step 6: Instrument `releaseToPending`**

Replace `releaseToPending` (currently lines 244–253):

```ts
export async function releaseToPending(syncLogId: string): Promise<void> {
  syncLog.info('sync.released', { syncLogId });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedBy: null,
    },
  });
}
```

- [ ] **Step 7: Instrument `markRetryable`**

Replace `markRetryable` (currently lines 271–289). Note: compute `nextAttemptAt` once, log it, then write:

```ts
export async function markRetryable(
  syncLogId: string,
  attemptCount: number,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const backoffMs = Math.min(30_000 * Math.pow(2, attemptCount - 1), 30 * 60_000);
  const nextAttemptAt = new Date(Date.now() + backoffMs);
  syncLog.warn('sync.retryable', {
    syncLogId,
    attemptCount,
    errorCode,
    nextAttemptAt: nextAttemptAt.toISOString(),
  });
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'FAILED_RETRYABLE',
      errorCode,
      errorMessage,
      nextAttemptAt,
      claimedAt: null,
      claimedBy: null,
    },
  });
}
```

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @pazarsync/sync-core typecheck
```

Expected: clean.

- [ ] **Step 9: Run sync-core integration tests (claim test still depends on these helpers)**

```bash
pnpm --filter @pazarsync/sync-core test:integration
```

Expected: existing `claim.test.ts` passes — instrumentation must be additive, not behavior-changing. (Requires `supabase start` + `pnpm db:push` first.)

- [ ] **Step 10: Commit (ASK USER FIRST)**

Ask: "Ready to commit Task 2 as `feat(sync-core): instrument SyncLog lifecycle transitions`?"

```bash
git add packages/sync-core/src/sync-log.service.ts
git commit -m "$(cat <<'EOF'
feat(sync-core): instrument SyncLog lifecycle transitions

acquireSlot, tick, complete, fail, releaseToPending, and markRetryable
now emit a single structured log line per call. Logs are emitted
BEFORE the DB write so a failed write still surfaces in stdout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Instrument the worker (`apps/sync-worker/src/index.ts`)

**Files:**
- Modify: `apps/sync-worker/src/index.ts`

This task replaces every `console.log/error` with a structured `syncLog` call AND adds three new logs the handoff §C.3 requires:

1. **`worker.poll.idle`** — throttled to once per 30 s when `tryClaimNext` returns null. Without throttling we'd log every 100 ms during the first second of idle (the backoff schedule starts at 100 ms).
2. **`worker.run.start` / `worker.run.complete`** — bracket each `runSyncToCompletion` call.
3. **`watchdog.reaped`** — emitted from the watchdog interval callback, only when reaped count > 0.

- [ ] **Step 1: Replace the file**

Overwrite `apps/sync-worker/src/index.ts`:

```ts
// Sync worker entry point.
//
// Long-running process that polls `sync_logs` for claimable rows
// (PENDING, or FAILED_RETRYABLE whose backoff has elapsed), then drives
// each claim through chunks until the run terminates or the worker is
// shutting down.
//
// Lifecycle:
//   1. Install SIGTERM/SIGINT handlers — both flip `shuttingDown` so the
//      claim loop exits between chunks (never mid-chunk; chunks are
//      atomic w.r.t. their own DB writes).
//   2. Start a watchdog timer that sweeps stale RUNNING claims back to
//      PENDING every WATCHDOG_INTERVAL_MS so a crashed peer's work is
//      reclaimable.
//   3. Poll-and-claim loop with exponential backoff when no row is
//      claimable. On a successful claim, hand off to runSyncToCompletion;
//      on a thrown error, classify it (permanent → FAIL, transient →
//      markRetryable with exponential backoff up to MAX_ATTEMPTS).
//
// Error classification rationale:
//   - MARKETPLACE_AUTH_FAILED / MARKETPLACE_ACCESS_DENIED → user must
//     fix credentials/whitelist; retrying does not help. Mark FAILED so
//     the SyncCenter UI shows a terminal error and the user takes action.
//   - CORRUPT_CHECKPOINT → the row's pageCursor is unparseable; future
//     claims would crash on the same data. Terminal FAIL.
//   - All other errors → transient (network blip, marketplace 5xx,
//     transient DB failure). markRetryable bumps the row to
//     FAILED_RETRYABLE with `nextAttemptAt` set by the backoff schedule
//     in syncLogService.markRetryable. Once attemptCount reaches
//     MAX_ATTEMPTS we give up and mark the row terminally FAILED.

import { randomBytes } from 'node:crypto';

import { markRetryable, syncLog, syncLogService, tryClaimNext } from '@pazarsync/sync-core';

import type { Registry } from './dispatcher';
import { productsHandler } from './handlers/products';
import { runSyncToCompletion } from './loop';
import { sweepStaleClaims } from './watchdog';

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`;
const POLL_BACKOFF_INITIAL_MS = 100;
const POLL_BACKOFF_MAX_MS = 5_000;
const POLL_BACKOFF_MULTIPLIER = 1.5;
const WATCHDOG_INTERVAL_MS = 30_000;
const IDLE_LOG_THROTTLE_MS = 30_000;
const MAX_ATTEMPTS = 5;

// Permanent failure codes — markFailed terminally, never markRetryable.
// Adding a new permanent code? Update this set + add a comment in the
// handler that throws it explaining why retry would not help.
const PERMANENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'CORRUPT_CHECKPOINT',
]);

const REGISTRY: Registry = {
  PRODUCTS: productsHandler,
  // ORDERS, SETTLEMENTS will register here as they land.
};

let shuttingDown = false;
function isShuttingDown(): boolean {
  return shuttingDown;
}

async function main(): Promise<void> {
  syncLog.info('worker.starting', { workerId: WORKER_ID });

  process.on('SIGTERM', () => {
    shuttingDown = true;
    syncLog.info('worker.shutdown.requested', { workerId: WORKER_ID, signal: 'SIGTERM' });
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
    syncLog.info('worker.shutdown.requested', { workerId: WORKER_ID, signal: 'SIGINT' });
  });

  const watchdogTimer = setInterval(() => {
    sweepStaleClaims()
      .then((reapedCount) => {
        if (reapedCount > 0) {
          syncLog.info('watchdog.reaped', { workerId: WORKER_ID, count: reapedCount });
        }
      })
      .catch((err: unknown) => {
        syncLog.error('watchdog.error', {
          workerId: WORKER_ID,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
  }, WATCHDOG_INTERVAL_MS);

  let backoff = POLL_BACKOFF_INITIAL_MS;
  let lastIdleLogAt = 0;

  while (!shuttingDown) {
    try {
      const claimed = await tryClaimNext(WORKER_ID);
      if (claimed === null) {
        const now = Date.now();
        if (now - lastIdleLogAt >= IDLE_LOG_THROTTLE_MS) {
          syncLog.info('worker.poll.idle', { workerId: WORKER_ID });
          lastIdleLogAt = now;
        }
        await sleep(backoff);
        backoff = Math.min(backoff * POLL_BACKOFF_MULTIPLIER, POLL_BACKOFF_MAX_MS);
        continue;
      }
      backoff = POLL_BACKOFF_INITIAL_MS;
      lastIdleLogAt = 0;
      syncLog.info('worker.claim.acquired', {
        workerId: WORKER_ID,
        syncLogId: claimed.id,
        syncType: claimed.syncType,
        attemptCount: claimed.attemptCount,
      });

      try {
        syncLog.info('worker.run.start', {
          workerId: WORKER_ID,
          syncLogId: claimed.id,
          syncType: claimed.syncType,
        });
        await runSyncToCompletion(claimed, REGISTRY, isShuttingDown);
        syncLog.info('worker.run.complete', { workerId: WORKER_ID, syncLogId: claimed.id });
      } catch (err) {
        syncLog.error('worker.run.error', {
          workerId: WORKER_ID,
          syncLogId: claimed.id,
          errorCode: errorCodeOf(err),
          errorMessage: errorMessageOf(err),
        });
        await handleRunError(claimed.id, claimed.attemptCount, err);
      }
    } catch (loopErr) {
      // Outer catch protects against systemic failures (DB connection
      // dropped, malformed claim row, etc.). Back off the full max
      // window so we do not hot-spin while the underlying issue resolves.
      syncLog.error('worker.outer.error', {
        workerId: WORKER_ID,
        errorMessage: loopErr instanceof Error ? loopErr.message : String(loopErr),
      });
      await sleep(POLL_BACKOFF_MAX_MS);
    }
  }

  clearInterval(watchdogTimer);
  syncLog.info('worker.stopped', { workerId: WORKER_ID });
}

async function handleRunError(
  syncLogId: string,
  attemptCount: number,
  err: unknown,
): Promise<void> {
  const code = errorCodeOf(err);
  const message = errorMessageOf(err);

  if (PERMANENT_FAILURE_CODES.has(code)) {
    await syncLogService.fail(syncLogId, code, message);
    return;
  }

  if (attemptCount >= MAX_ATTEMPTS) {
    await syncLogService.fail(syncLogId, code, `${message} (max retries reached)`);
    return;
  }

  await markRetryable(syncLogId, attemptCount, code, message);
}

/**
 * Narrow an unknown caught value to extract its `code` string, if any.
 * Mirrors the structural-narrowing pattern used in
 * `apps/api/src/lib/map-prisma-error.ts` and `sync-log.service.ts`'s
 * `isUniqueViolation` — the documented exception in CLAUDE.md for
 * runtime structural type guards on third-party / unknown shapes.
 */
function errorCodeOf(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((fatal: unknown) => {
  syncLog.error('worker.fatal', {
    errorMessage: fatal instanceof Error ? fatal.message : String(fatal),
  });
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @pazarsync/sync-worker typecheck
```

Expected: clean.

- [ ] **Step 3: Worker unit tests still pass**

```bash
pnpm --filter @pazarsync/sync-worker test:unit
```

Expected: existing `dispatcher.test.ts` and `loop.test.ts` pass. The new logs are additive; behavior unchanged.

- [ ] **Step 4: Worker integration tests still pass**

```bash
pnpm --filter @pazarsync/sync-worker test:integration
```

Expected: `products-handler.test.ts` and `watchdog.test.ts` pass. (Needs `supabase start` + `pnpm db:push`.)

- [ ] **Step 5: Commit (ASK USER FIRST)**

Ask: "Ready to commit Task 3 as `feat(sync-worker): structured logging across boot, claim, run, watchdog`?"

```bash
git add apps/sync-worker/src/index.ts
git commit -m "$(cat <<'EOF'
feat(sync-worker): structured logging across boot, claim, run, watchdog

Replaces console.log/error with syncLog calls. Adds three new events:
- worker.poll.idle (throttled to once per 30 s)
- worker.run.start / worker.run.complete bracketing each claim's run
- watchdog.reaped emitted only when sweepStaleClaims returns > 0

The watchdog catch path now logs a structured error rather than dumping
the full stack to console.error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Instrument the products handler

**Files:**
- Modify: `apps/sync-worker/src/handlers/products.ts`

The handoff §C.4 requires three logs in the products handler:
- `chunk.start` at the top of `processProductsChunk`
- `chunk.complete` before returning a `continue` result
- Replace the `[product-sync] content-upsert failed` `console.error` with `content.upsert.failed`

- [ ] **Step 1: Add the import**

Edit `apps/sync-worker/src/handlers/products.ts`. Update the imports block at the top:

```ts
import { prisma } from '@pazarsync/db';
import type { Store, SyncLog } from '@pazarsync/db';
import {
  fetchApprovedProducts,
  isTrendyolCredentials,
  type MappedProduct,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import {
  decryptCredentials,
  parseProductsCursor,
  syncLog,
  type ProductsCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';
```

- [ ] **Step 2: Add `chunk.start` at the top of `processProductsChunk`**

Edit `processProductsChunk`. The body currently starts with destructuring `syncLog` from input — but that name now collides with the imported `syncLog`. Rename the destructure to `log` to avoid shadowing:

Replace lines 26–31 (the function signature and first three lines of body):

```ts
export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const cursor = parseProductsCursor(input.cursor);
  syncLog.info('chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor: input.cursor,
    progressCurrent: log.progressCurrent,
  });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
```

Then update every other reference inside `processProductsChunk` from `syncLog.X` (the parameter) to `log.X`. The remaining references are:
- `syncLog.progressCurrent` → `log.progressCurrent` (twice, in the two `done` returns)
- `syncLog.progressCurrent + batch.length` → `log.progressCurrent + batch.length`

The full updated function body is (replace the entire `processProductsChunk` function definition):

```ts
export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog: log } = input;
  const cursor = parseProductsCursor(input.cursor);
  syncLog.info('chunk.start', {
    syncLogId: log.id,
    storeId: log.storeId,
    cursor: input.cursor,
    progressCurrent: log.progressCurrent,
  });
  const store = await prisma.store.findUniqueOrThrow({ where: { id: log.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Generator yields the FIRST page, then we return — the dispatcher loops
  // back through the queue with our cursor for the next page.
  const generator = fetchApprovedProducts({
    environment: store.environment,
    credentials,
    initialCursor: cursor,
  });
  const { value, done } = await generator.next();

  // Trendyol returned no more content (empty content[]) — sync is complete.
  if (done === true || value === undefined) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    return { kind: 'done', finalCount: log.progressCurrent };
  }

  await upsertBatch(store, batch, log.id);

  const newProgress = log.progressCurrent + batch.length;

  // Cursor advances: prefer Trendyol's own nextPageToken when present
  // (it returns one past the 10k page-cap, and may for non-cap'd pages
  // too — using it is always correct). Otherwise increment the page index.
  let nextCursor: ProductsCursor;
  if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
    nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
  } else {
    const currentN = cursor === null ? 0 : cursor.kind === 'page' ? cursor.n : 0;
    nextCursor = { kind: 'page', n: currentN + 1 };
  }

  if (newProgress >= pageMeta.totalElements) {
    return { kind: 'done', finalCount: newProgress };
  }

  syncLog.info('chunk.complete', {
    syncLogId: log.id,
    pageBatchSize: batch.length,
    newProgress,
    totalElements: pageMeta.totalElements,
    nextCursor,
  });

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'upserting',
  };
}
```

- [ ] **Step 3: Update `upsertBatch` signature to take `syncLogId` and replace `console.error`**

Replace the entire `upsertBatch` function. Change is twofold: accept `syncLogId` so `content.upsert.failed` can include it, and swap `console.error` for `syncLog.error`:

```ts
async function upsertBatch(
  store: Store,
  batch: MappedProduct[],
  syncLogId: string,
): Promise<void> {
  // ─── PORTED VERBATIM from apps/api/src/services/product-sync.service.ts ──
  // One transaction per content (parent + its variants + image replace).
  // Each content also runs inside a try/catch — a single malformed
  // product (rare, but real Trendyol data has shipped duplicate
  // barcodes within a store, missing required fields, etc.) gets
  // logged and skipped so the sync completes for every other product
  // in the page.
  for (const mapped of batch) {
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.upsert({
          where: {
            storeId_platformContentId: {
              storeId: store.id,
              platformContentId: mapped.platformContentId,
            },
          },
          create: {
            organizationId: store.organizationId,
            storeId: store.id,
            platformContentId: mapped.platformContentId,
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
          update: {
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
        });

        for (const variant of mapped.variants) {
          await tx.productVariant.upsert({
            where: {
              storeId_platformVariantId: {
                storeId: store.id,
                platformVariantId: variant.platformVariantId,
              },
            },
            create: {
              organizationId: store.organizationId,
              storeId: store.id,
              productId: product.id,
              platformVariantId: variant.platformVariantId,
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              lastSyncedAt: new Date(),
            },
            update: {
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              lastSyncedAt: new Date(),
            },
          });
        }

        // Replace images for this product. ProductImage rows have no
        // per-image identifier we can match against (Trendyol gives an
        // ordered URL list), so the cleanest semantic is "this is the
        // new ordered set, drop the previous set".
        await tx.productImage.deleteMany({ where: { productId: product.id } });
        if (mapped.images.length > 0) {
          await tx.productImage.createMany({
            data: mapped.images.map((img) => ({
              organizationId: store.organizationId,
              productId: product.id,
              url: img.url,
              position: img.position,
            })),
          });
        }
      });
    } catch (err) {
      syncLog.error('content.upsert.failed', {
        syncLogId,
        storeId: store.id,
        platformContentId: mapped.platformContentId.toString(),
        productMainId: mapped.productMainId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Skip and continue — one bad content cannot abort the run.
    }
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @pazarsync/sync-worker typecheck
```

Expected: clean. The variable rename (`syncLog` parameter → `log`) is the most error-prone part — any reference still using the old name will surface here.

- [ ] **Step 5: Run handler integration test**

```bash
pnpm --filter @pazarsync/sync-worker test:integration -- products-handler
```

Expected: pass. The test's behavior assertions are unchanged; new log calls are additive.

- [ ] **Step 6: Commit (ASK USER FIRST)**

Ask: "Ready to commit Task 4 as `feat(sync-worker): structured logs in products handler`?"

```bash
git add apps/sync-worker/src/handlers/products.ts
git commit -m "$(cat <<'EOF'
feat(sync-worker): structured logs in products handler

Adds chunk.start (with cursor + progressCurrent) and chunk.complete
(with new progress + nextCursor) around the per-page work. Replaces
the [product-sync] content-upsert failed console.error with a
syncLog.error call carrying syncLogId so the failure is correlatable
with the run that produced it. The processChunk parameter is renamed
from syncLog → log inside the function to avoid shadowing the imported
logger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Instrument the API trigger handler

**Files:**
- Modify: `apps/api/src/routes/product.routes.ts`

After `acquireSlot` returns, log `trigger.enqueued` with the userId, storeId, organizationId, syncLogId, and the request id (per `apps/api/CLAUDE.md`'s correlation-id rule).

- [ ] **Step 1: Add the import**

Edit `apps/api/src/routes/product.routes.ts`. Replace the second import line:

```ts
import { syncLog, syncLogService } from '@pazarsync/sync-core';
```

- [ ] **Step 2: Add the log after `acquireSlot`**

Inside the `app.openapi(startSyncRoute, async (c) => { ... })` handler (currently lines 92–112), insert the log immediately after `acquireSlot` returns:

```ts
app.openapi(startSyncRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const store = await storeService.requireOwnedStore(organizationId, storeId);

  // Pure enqueue: INSERT a PENDING SyncLog row and return. The worker
  // process picks it up via tryClaimNext within ~1 s. P2002 from the
  // partial unique index is mapped to SyncInProgressError(409) with
  // meta.existingSyncLogId by acquireSlot itself.
  const log = await syncLogService.acquireSlot(organizationId, store.id, 'PRODUCTS');

  syncLog.info('trigger.enqueued', {
    syncLogId: log.id,
    organizationId,
    storeId: store.id,
    syncType: 'PRODUCTS',
    userId,
    requestId: c.req.header('X-Request-Id'),
  });

  return c.json(
    {
      syncLogId: log.id,
      status: 'PENDING' as const,
      enqueuedAt: log.startedAt.toISOString(),
    },
    202,
  );
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @pazarsync/api typecheck
```

Expected: clean.

- [ ] **Step 4: API integration tests still pass**

```bash
pnpm --filter @pazarsync/api test:integration -- product
```

Expected: every existing `routes/product.*` test passes.

- [ ] **Step 5: Commit (ASK USER FIRST)**

Ask: "Ready to commit Task 5 as `feat(api): log trigger.enqueued on product sync start`?"

```bash
git add apps/api/src/routes/product.routes.ts
git commit -m "$(cat <<'EOF'
feat(api): log trigger.enqueued on product sync start

Emits a single structured log line after acquireSlot returns,
including the request id for end-to-end correlation. The Slot
acquired/conflict events from sync-log.service already cover the
DB-side observability — this closes the gap between API entry and
worker pickup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verify pnpm dev wires the worker + final gate

**Files:**
- (verify only) `package.json`, `turbo.json`, `apps/sync-worker/package.json`

The §B-prevention work boils down to: confirm `pnpm dev` from repo root starts API + web + worker. We confirmed earlier that `apps/sync-worker/package.json` defines `dev: "tsx watch --env-file=../../.env src/index.ts"` and `turbo run dev` (the root `dev` script) runs the `dev` task in every workspace package that has one. Worth a 10-second runtime check before declaring §B done.

- [ ] **Step 1: Smoke `pnpm dev`**

In a fresh terminal (so no orphan workers interfere):

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
pnpm dev 2>&1 | head -40
```

Expected: stdout contains lines from all three packages — `@pazarsync/api`, `@pazarsync/web`, `@pazarsync/sync-worker`. The worker line should include `· [sync] worker.starting workerId=worker-XXXX` (proves the new logger is wired).

If the worker line is missing → `apps/sync-worker` is not in the turbo dev pipeline. Fix by adding `apps/sync-worker` to whichever filter excludes it (likely none — turbo runs every package's `dev` script by default).

Press `Ctrl-C` to stop.

- [ ] **Step 2: Manual end-to-end smoke (the §C acceptance criterion)**

Run:

```bash
pnpm dev
```

In the browser, sign in, navigate to a store's products page, click "Ürünleri şimdi senkronize et". The API and worker stdout streams are merged by `turbo run dev`, so you'll see (roughly in this order — items 1–3 are synchronous within the API request, item 4 onward is the worker picking up the row within ~100 ms):

```
# (API process) — synchronous within POST /products/sync
· [sync] slot.acquire.attempt organizationId=… storeId=… syncType=PRODUCTS
· [sync] slot.acquired organizationId=… storeId=… syncType=PRODUCTS syncLogId=…
· [sync] trigger.enqueued syncLogId=… organizationId=… storeId=… syncType=PRODUCTS userId=… requestId=…

# (Worker process) — picks up within ~100 ms
· [sync] worker.claim.acquired workerId=worker-XXXX syncLogId=… syncType=PRODUCTS attemptCount=0
· [sync] worker.run.start workerId=worker-XXXX syncLogId=… syncType=PRODUCTS
· [sync] chunk.start syncLogId=… storeId=… cursor=null progressCurrent=0
· [sync] chunk.complete syncLogId=… pageBatchSize=… newProgress=… totalElements=… nextCursor={"kind":"page","n":1}
· [sync] chunk.tick syncLogId=… progress=… total=… stage=upserting cursor={"kind":"page","n":1}
… (chunk.start / chunk.complete / chunk.tick repeats per page) …
· [sync] sync.completed syncLogId=… finalCount=…
· [sync] worker.run.complete workerId=worker-XXXX syncLogId=…
```

- [ ] **Step 3: Manual failure-path smoke**

Trigger another sync, then quickly revoke the store's Trendyol creds (e.g., update the store row's encrypted creds via Prisma Studio) before the second chunk fires. You should see:

```
· [sync] chunk.start …
✗ [sync] worker.run.error workerId=… syncLogId=… errorCode=MARKETPLACE_AUTH_FAILED errorMessage=…
✗ [sync] sync.failed syncLogId=… errorCode=MARKETPLACE_AUTH_FAILED errorMessage=…
```

Or for a transient 5xx (simulated by killing the marketplace's local mock if applicable, or by waiting for a real 5xx):

```
· [sync] chunk.start …
✗ [sync] worker.run.error workerId=… syncLogId=… errorCode=MARKETPLACE_UNREACHABLE …
! [sync] sync.retryable syncLogId=… attemptCount=1 errorCode=MARKETPLACE_UNREACHABLE nextAttemptAt=…
```

After waiting past `nextAttemptAt`:

```
· [sync] worker.claim.acquired workerId=… syncLogId=… (same id) attemptCount=2
· [sync] chunk.start syncLogId=… cursor={"kind":"page","n":N}  ← resumes from saved cursor
```

- [ ] **Step 4: `pnpm check:full` from repo root**

```bash
pnpm check:full
```

Expected: green. Mirrors what CI runs. Needs `supabase start` + `pnpm db:push` first. If it fails, fix the underlying issue — never `--no-verify`.

- [ ] **Step 5: Push the branch and open the PR**

```bash
git push -u origin feat/sync-observability
```

Then:

```bash
gh pr create --title "feat(sync): wire pnpm dev + structured logging across the engine" --body "$(cat <<'EOF'
## Summary

PR #1 of seven (see [`docs/plans/2026-04-28-sync-engine-completion-execution.md`](docs/plans/2026-04-28-sync-engine-completion-execution.md)).

- Adds `syncLog` to `@pazarsync/sync-core` — tiny zero-dep structured logger; pretty in dev, JSON in production.
- Instruments every state transition in the sync engine: `slot.acquired/conflict`, `chunk.start/complete/tick`, `sync.completed/failed/retryable/released`, `worker.starting/claim.acquired/run.start/run.complete/run.error/poll.idle/shutdown.requested/stopped`, `watchdog.reaped/error`, `trigger.enqueued`, `content.upsert.failed`, `worker.fatal`.
- Bundles the planning docs (audit, handoff, execution spec, this PR's plan) so reviewers have full context.

The `pnpm dev` "worker not running" foot-gun is closed: turbo already runs the worker's `dev` script (verified by the smoke test in the plan); no config change needed.

## Test plan

- [ ] `pnpm --filter @pazarsync/sync-core test:unit` — logger tests pass
- [ ] `pnpm check:full` from repo root — typecheck + lint + all tests + format
- [ ] Manual smoke: `pnpm dev`, trigger a Trendyol product sync, observe the full log chain end-to-end
- [ ] Manual failure-path smoke: revoke creds mid-sync, observe `worker.run.error` → `sync.retryable` chain
- [ ] After waiting past `nextAttemptAt`, observe `worker.claim.acquired` → `chunk.start` resumes from saved cursor

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-review notes (against the spec)

- **Spec coverage check (§3 PR #1 acceptance):**
  - ✅ Logger module created (Task 1)
  - ✅ Every state transition instrumented in `sync-log.service.ts` (Task 2)
  - ✅ Worker boot/claim/run/idle/shutdown/watchdog instrumented (Task 3)
  - ✅ Products handler chunk.start/chunk.complete/content.upsert.failed instrumented (Task 4)
  - ✅ API trigger.enqueued instrumented (Task 5)
  - ✅ `pnpm dev` worker pipeline verified (Task 6 Step 1)
  - ✅ End-to-end + failure-path smoke (Task 6 Steps 2–3)
- **Type consistency:** `syncLog` is consistently the imported logger; `log` is the local rename inside `processProductsChunk` to avoid shadowing the parameter.
- **Per-PR gates respected:** typecheck after every file change, target tests after every package change, full `pnpm check:full` before PR, branch + PR (no main commit), commit message convention with co-author trailer, ask-before-commit at every commit boundary.
- **No placeholders.** Every step has exact paths, complete code, and concrete commands with expected output.
