# Launch-Readiness Implementation Plan (Group 4)

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land the five "post-production" repo capabilities (CODEOWNERS, bundle size gate, transactional email, backup-restore drill, uptime monitoring) before the first real customer signs up.

**Architecture:** Each task is independent and can be executed in any order. Recommended ordering by launch-blocking severity:

| #     | Task                                       | Blocks launch?    | Effort       | When                          |
| ----- | ------------------------------------------ | ----------------- | ------------ | ----------------------------- |
| **3** | Transactional email (Resend)               | YES — signup flow | ~½ day       | Right after auth middleware   |
| **5** | Uptime monitoring (Healthchecks.io)        | YES — post-deploy | ~30 min      | Day of first deploy           |
| **2** | Bundle size gate (size-limit + CI)         | No, but risky     | ~2 h         | Before first deploy           |
| **4** | Backup-restore drill (pg_dump + Postgres)  | No                | ~1 day       | Once real customer data lands |
| **1** | CODEOWNERS                                 | No                | ~10 min      | Once second contributor joins |

**Tech Stack:**

- **Email:** Resend SDK + React Email templates (rendered to HTML server-side).
- **Bundle:** `size-limit` with `@size-limit/file` (filesystem-based, plays nice with Next.js 16 Turbopack output).
- **Backup drill:** `pg_dump` against the Supabase prod connection + restore into a throwaway Docker Postgres + sanity SQL. **All shell calls go through `execFileSync` — never `execSync` with template literals (command injection risk).**
- **Uptime:** Healthchecks.io free tier — periodic heartbeat ping from a Supabase Edge Function (no extra infra).
- **CODEOWNERS:** GitHub-native, single file, no tooling.

**Pre-flight checklist (do once before starting any task):**

- [ ] Auth middleware merged (blocks Task 3 — without auth there's no user record to email).
- [ ] First production deploy planned (Task 5 needs a public URL to ping; Task 2 needs Next.js build output).
- [ ] Decide which org will own the Resend account + Healthchecks.io account (personal vs company email).

---

## Task 1: CODEOWNERS

**Why:** Routes review requests automatically when the team grows past one. Costs nothing now, prevents forgotten reviews later. Skippable if still solo and likely to stay solo for ≥6 months.

**Files:**

- Create: `.github/CODEOWNERS`

**Step 1: Create the file**

```
# Default owner — anything not matched below
*                                @berkinoktay

# Critical security surfaces — explicit ownership prevents accidental
# bypass when more reviewers exist
docs/SECURITY.md                 @berkinoktay
apps/api/src/middleware/         @berkinoktay
apps/api/src/lib/crypto.ts       @berkinoktay
packages/db/prisma/schema.prisma @berkinoktay
supabase/sql/                    @berkinoktay

# CI / repo automation — owner approval required for changes that
# could weaken the gate (e.g. removing the `test` job)
.github/                         @berkinoktay
.husky/                          @berkinoktay
```

**Step 2: Commit**

```bash
git add .github/CODEOWNERS
git commit -m "chore: add CODEOWNERS for routing reviews to security-critical paths"
```

**Step 3: Enable in branch protection (manual GitHub UI step)**

Settings → Branches → main → Edit → check "Require review from Code Owners". Without this, the file is decorative — it suggests reviewers but doesn't enforce them.

**Done when:** Opening any PR auto-requests review from the path's owner.

---

## Task 2: Bundle size gate (size-limit + CI)

**Why:** A single accidental import of a heavy library (e.g. `import _ from 'lodash'` instead of `lodash/debounce`, or pulling a full charting suite when one chart is needed) can bloat the first-load JS by hundreds of KB. Without a gate, this only surfaces when a user reports a slow page — by then the bloat is in production. Catching it in CI keeps the budget honest.

**Files:**

- Modify: `package.json` (add `size-limit` + plugin + script)
- Create: `.size-limit.json` at repo root
- Modify: `.github/workflows/ci.yml` (add `bundle-size` job)

**Step 1: Install dependencies**

```bash
pnpm add -Dw size-limit @size-limit/file
```

Expected: `+ size-limit ^11.x.x` and `+ @size-limit/file ^11.x.x` in root `devDependencies`.

**Step 2: Build the web app once to discover real chunk paths**

```bash
pnpm build --filter web
```

Inspect `apps/web/.next/static/chunks/` to identify the framework, main, and per-route chunks. The set of files Next.js emits depends on routes — re-check after major route additions.

**Step 3: Create `.size-limit.json` with starting budgets**

```json
[
  {
    "name": "Next.js framework runtime",
    "path": "apps/web/.next/static/chunks/framework-*.js",
    "limit": "55 KB",
    "gzip": true
  },
  {
    "name": "Next.js main runtime",
    "path": "apps/web/.next/static/chunks/main-*.js",
    "limit": "30 KB",
    "gzip": true
  },
  {
    "name": "App entry (per-route bundles combined)",
    "path": "apps/web/.next/static/chunks/app/**/*.js",
    "limit": "150 KB",
    "gzip": true
  }
]
```

The numbers are starting placeholders. Run step 4 once and let size-limit print actuals; bump each `limit` to (actual × 1.10) so a 10% regression is rejected but small additions pass.

**Step 4: Add the script to root `package.json`**

```json
{
  "scripts": {
    "size": "size-limit",
    "size:why": "size-limit --why"
  }
}
```

`size:why` opens an interactive bundle analyzer — useful when a CI run fails.

**Step 5: Run locally and lock in baseline**

```bash
pnpm build --filter web && pnpm size
```

Expected: a green table showing each entry under its limit. Adjust `.size-limit.json` limits to (printed_size × 1.10), commit the adjusted file.

**Step 6: Add CI job (extend `.github/workflows/ci.yml`)**

```yaml
bundle-size:
  name: Bundle size budget
  needs: changes
  if: needs.changes.outputs.code == 'true'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: "pnpm"
    - run: pnpm install --frozen-lockfile
    - run: pnpm db:generate
    - run: pnpm api:sync
    - run: pnpm build --filter web
    - run: pnpm size
```

Reuses the existing `changes` job — bundle check is skipped on docs-only PRs (consistent with the test job).

**Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .size-limit.json .github/workflows/ci.yml
git commit -m "chore: add bundle size budget via size-limit + CI gate"
```

**Done when:** A test PR that adds a wasteful import (`import _ from 'lodash'`) fails the `bundle-size` job; removing the import passes.

---

## Task 3: Transactional email (Resend + React Email)

**Why:** Auth signup needs a confirmation email. Org-member invites need an invite link. Sync failures need to alert the store owner. Without a transactional sender, none of these flows work — the user can sign up but never receive the verification link.

**Files:**

- Create: `apps/api/src/lib/email/client.ts` — Resend client singleton
- Create: `apps/api/src/lib/email/send.ts` — `sendEmail()` wrapper
- Create: `apps/api/src/lib/email/templates/welcome.tsx` — first React Email template
- Create: `apps/api/src/lib/email/templates/render.ts` — template-to-HTML helper
- Create: `apps/api/tests/unit/lib/email/send.test.ts`
- Create: `apps/api/tests/unit/lib/email/render.test.ts`
- Modify: `apps/api/package.json` — add deps
- Modify: `.env.example` — add `RESEND_API_KEY` + `EMAIL_FROM`

**Step 1: Sign up for Resend (manual)**

1. Create account at <https://resend.com>.
2. Add and verify a sending domain (`mail.pazarsync.com` or similar — DNS TXT records).
3. Generate an API key (Dashboard → API Keys → Create).
4. **Do not commit the key.** Store in `.env` (gitignored) and 1Password / your secret manager.

**Step 2: Install dependencies**

```bash
pnpm --filter @pazarsync/api add resend
pnpm --filter @pazarsync/api add -D @react-email/components @react-email/render react react-dom
```

`react` and `react-dom` are required peer deps for `@react-email/components` even though the API is server-only.

**Step 3: Update `.env.example`**

```
# ─── apps/api: email ─────────────────────────────
# Resend transactional sender. https://resend.com/api-keys
# WARNING: rotating this key invalidates the live key — coordinate
# rotation with a window of ~5 minutes where both keys are valid.
RESEND_API_KEY=
EMAIL_FROM=PazarSync <noreply@mail.pazarsync.com>
```

**Step 4: Write the failing test for `sendEmail`**

Create `apps/api/tests/unit/lib/email/send.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail } from '../../../../src/lib/email/send';

vi.mock('../../../../src/lib/email/client', () => ({
  getResendClient: vi.fn(),
}));

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['EMAIL_FROM'] = 'Test <test@example.com>';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls Resend with from/to/subject/html', async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const { getResendClient } = await import('../../../../src/lib/email/client');
    vi.mocked(getResendClient).mockReturnValue({ emails: { send } } as never);

    await sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(send).toHaveBeenCalledWith({
      from: 'Test <test@example.com>',
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });
  });

  it('throws when Resend returns an error', async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: 'rate limited' } });
    const { getResendClient } = await import('../../../../src/lib/email/client');
    vi.mocked(getResendClient).mockReturnValue({ emails: { send } } as never);

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' }),
    ).rejects.toThrow(/rate limited/);
  });
});
```

**Step 5: Run the test to confirm it fails**

```bash
pnpm --filter @pazarsync/api test:unit -- send
```

Expected: FAIL with module not found `../../../../src/lib/email/send`.

**Step 6: Implement `client.ts`**

Create `apps/api/src/lib/email/client.ts`:

```typescript
import { Resend } from 'resend';

let cached: Resend | null = null;

export function getResendClient(): Resend {
  if (cached !== null) return cached;
  const apiKey = process.env['RESEND_API_KEY'];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('RESEND_API_KEY is required to send transactional email.');
  }
  cached = new Resend(apiKey);
  return cached;
}

// Test-only: drop the cached client so a new env var is picked up.
export function resetResendClient(): void {
  cached = null;
}
```

**Step 7: Implement `send.ts`**

Create `apps/api/src/lib/email/send.ts`:

```typescript
import { getResendClient } from './client';

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const from = process.env['EMAIL_FROM'];
  if (from === undefined || from.length === 0) {
    throw new Error('EMAIL_FROM is required to send transactional email.');
  }
  const client = getResendClient();
  const { data, error } = await client.emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (error !== null) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
  return { id: data.id };
}
```

**Step 8: Run the test to confirm it passes**

```bash
pnpm --filter @pazarsync/api test:unit -- send
```

Expected: 2 passed.

**Step 9: Write the failing test for `renderTemplate`**

Create `apps/api/tests/unit/lib/email/render.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../../../../src/lib/email/templates/render';
import { WelcomeEmail } from '../../../../src/lib/email/templates/welcome';

describe('renderTemplate', () => {
  it('renders the WelcomeEmail to HTML containing the recipient name', async () => {
    const html = await renderTemplate(WelcomeEmail({ name: 'Berkin' }));
    expect(html).toContain('Berkin');
    expect(html).toContain('<html');
  });
});
```

Run: `pnpm --filter @pazarsync/api test:unit -- render` → FAIL.

**Step 10: Implement `welcome.tsx` and `render.ts`**

Create `apps/api/src/lib/email/templates/welcome.tsx`:

```tsx
import { Body, Container, Head, Html, Preview, Text } from '@react-email/components';

export interface WelcomeEmailProps {
  name: string;
}

export function WelcomeEmail({ name }: WelcomeEmailProps): JSX.Element {
  return (
    <Html lang="tr">
      <Head />
      <Preview>PazarSync hesabınız hazır</Preview>
      <Body>
        <Container>
          <Text>Merhaba {name},</Text>
          <Text>PazarSync hesabınız oluşturuldu. İlk mağazanızı bağlayarak başlayabilirsiniz.</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

Create `apps/api/src/lib/email/templates/render.ts`:

```typescript
import { render } from '@react-email/render';
import type { ReactElement } from 'react';

export async function renderTemplate(element: ReactElement): Promise<string> {
  return render(element);
}
```

Run: `pnpm --filter @pazarsync/api test:unit -- render` → PASS.

**Step 11: Smoke test against real Resend**

Add a temporary `apps/api/scripts/smoke-email.ts`:

```typescript
import { sendEmail } from '../src/lib/email/send';
import { renderTemplate } from '../src/lib/email/templates/render';
import { WelcomeEmail } from '../src/lib/email/templates/welcome';

const to = process.env['SMOKE_EMAIL_TO'];
if (to === undefined) throw new Error('SMOKE_EMAIL_TO required');

const html = await renderTemplate(WelcomeEmail({ name: 'Berkin' }));
const result = await sendEmail({ to, subject: 'PazarSync smoke test', html });
console.log(`Sent: ${result.id}`);
```

Run: `SMOKE_EMAIL_TO=your@email.com pnpm --filter @pazarsync/api exec tsx scripts/smoke-email.ts`.

Expected: an email arrives at the address; CLI prints the message ID. **Delete the script after verification** — it is a one-shot tool, not part of the codebase.

**Step 12: Commit**

```bash
git add apps/api/package.json apps/api/src/lib/email apps/api/tests/unit/lib/email .env.example pnpm-lock.yaml
git commit -m "feat(api): add transactional email via Resend + React Email"
```

**Done when:** A test that calls `sendEmail` with a Resend mock passes; smoke email arrives in inbox.

---

## Task 4: Backup-restore drill (pg_dump + ephemeral Postgres)

**Why:** Supabase Pro provides automated daily backups, but "backups exist" ≠ "I can restore from them". The first time a team learns their backups are corrupt or incomplete is during an actual outage — too late. A scheduled drill that downloads the latest backup, restores it to a throwaway Postgres, and runs sanity SQL gives true confidence in the recovery path.

**Files:**

- Create: `scripts/backup-drill.ts` (Node — uses `execFileSync` for shell calls, **never** `execSync` with template literals)
- Create: `.github/workflows/backup-drill.yml` (weekly schedule)
- Modify: `.env.example` — add `SUPABASE_PROJECT_REF` + `SUPABASE_MANAGEMENT_TOKEN`

**Step 1: Decide on connection strategy**

Two options:

- **A: pg_dump from prod read replica.** Connect to Supabase production with a read-only role, pg_dump to a temp file, restore to local. Requires creating a `backup_reader` Postgres role in Supabase with read-only access to the public schema.
- **B: Download Supabase's nightly backup file.** Supabase exposes pgdump archives via the Management API for Pro tier. Avoids talking to prod at all.

Option B is preferred (validates the actual backup pipeline, not a fresh dump). Documentation: <https://supabase.com/docs/reference/api/v1-list-backups>.

**Step 2: Add env to `.env.example`**

```
# ─── Backup drill (CI-only) ─────────────────────
# Service-role key with backups:read permission.
# https://supabase.com/dashboard/project/_/settings/api
SUPABASE_PROJECT_REF=
SUPABASE_MANAGEMENT_TOKEN=
```

Add the same secrets to GitHub Actions repo secrets (Settings → Secrets and variables → Actions).

**Step 3: Write `scripts/backup-drill.ts`**

```typescript
// Pulls the latest Supabase backup, restores into an ephemeral Postgres
// container, runs sanity queries, exits non-zero on any failure.
//
// SAFETY: every shell call uses execFileSync — args are passed as an
// array, never interpolated into a string. This prevents command
// injection if any input (e.g. a download URL) ever contains shell
// metacharacters. Never refactor to `execSync(\`docker run ${var}\`)`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PROJECT_REF = required('SUPABASE_PROJECT_REF');
const TOKEN = required('SUPABASE_MANAGEMENT_TOKEN');
const TEST_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54330/postgres';
const CONTAINER_NAME = 'backup-drill-pg';

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'backup-drill-'));
  try {
    const dumpPath = join(tmp, 'latest.sql');

    console.log('Fetching latest backup metadata...');
    const backup = await fetchLatestBackup();
    console.log(`Latest backup: ${backup.created_at} (${(backup.size / 1e6).toFixed(0)} MB)`);

    console.log('Downloading backup...');
    await downloadBackup(backup.url, dumpPath);

    console.log('Starting ephemeral Postgres on :54330...');
    execFileSync(
      'docker',
      [
        'run', '-d', '--rm', '--name', CONTAINER_NAME,
        '-e', 'POSTGRES_PASSWORD=postgres',
        '-p', '54330:5432',
        'postgres:15',
      ],
      { stdio: 'inherit' },
    );
    await waitForPostgres();

    console.log('Restoring dump...');
    execFileSync('psql', [TEST_DB_URL, '-f', dumpPath], { stdio: 'inherit' });

    console.log('Running sanity queries...');
    runSanity();

    console.log('✓ Backup drill PASSED.');
  } finally {
    try {
      execFileSync('docker', ['stop', CONTAINER_NAME], { stdio: 'ignore' });
    } catch {
      // already stopped — ignore
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface SupabaseBackup {
  created_at: string;
  size: number;
  url: string;
}

async function fetchLatestBackup(): Promise<SupabaseBackup> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/backups`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  if (!res.ok) throw new Error(`Backup list fetch failed: ${res.status.toString()}`);
  const body: unknown = await res.json();
  if (!isBackupListResponse(body) || body.backups.length === 0) {
    throw new Error('No backups returned by Supabase Management API');
  }
  return body.backups[0]!;
}

async function downloadBackup(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Backup download failed: ${res.status.toString()}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buffer);
}

async function waitForPostgres(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync('pg_isready', ['-h', '127.0.0.1', '-p', '54330', '-U', 'postgres'], {
        stdio: 'ignore',
      });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('Postgres did not become ready in 30 seconds');
}

function runSanity(): void {
  const queries = [
    { name: 'organizations table has rows', sql: 'SELECT count(*) FROM organizations' },
    { name: 'orders table exists', sql: 'SELECT count(*) FROM orders' },
  ];
  for (const q of queries) {
    const out = execFileSync('psql', [TEST_DB_URL, '-t', '-c', q.sql]).toString().trim();
    const n = Number(out);
    if (Number.isNaN(n)) throw new Error(`Sanity '${q.name}' returned non-numeric: ${out}`);
    console.log(`  ${q.name}: ${n.toString()}`);
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) throw new Error(`${name} is required`);
  return v;
}

function isBackupListResponse(v: unknown): v is { backups: SupabaseBackup[] } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'backups' in v &&
    Array.isArray((v as { backups: unknown }).backups)
  );
}

await main();
```

**Step 4: Run locally to verify**

```bash
SUPABASE_PROJECT_REF=... SUPABASE_MANAGEMENT_TOKEN=... pnpm exec tsx scripts/backup-drill.ts
```

Expected: prints download size, restore progress, sanity counts, ends with `✓ Backup drill PASSED`.

**Step 5: Schedule via GitHub Actions**

Create `.github/workflows/backup-drill.yml`:

```yaml
name: Backup-restore drill

on:
  schedule:
    - cron: "0 6 * * 1"  # 06:00 UTC every Monday
  workflow_dispatch:      # allow manual trigger

jobs:
  drill:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: Run backup drill
        env:
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
          SUPABASE_MANAGEMENT_TOKEN: ${{ secrets.SUPABASE_MANAGEMENT_TOKEN }}
        run: pnpm exec tsx scripts/backup-drill.ts
```

**Step 6: Commit**

```bash
git add scripts/backup-drill.ts .github/workflows/backup-drill.yml .env.example
git commit -m "chore: add weekly backup-restore drill (Supabase → ephemeral Postgres)"
```

**Done when:** Manual `workflow_dispatch` run completes green; weekly cron is visible in Actions.

---

## Task 5: Uptime monitoring (Healthchecks.io)

**Why:** Learning the API is down from a customer is a bad day. Free uptime services solve this with one HTTP check. Healthchecks.io is preferred over UptimeRobot because it inverts the model: instead of pinging from outside, the service expects YOU to ping IT — which catches "service is up but background jobs are silently failing" cases that an external HTTP probe misses.

**Files:**

- Verify: `apps/api/src/index.ts` registers `GET /v1/health`
- Modify: if missing, add the route mirroring `apps/api/scripts/dump-openapi.ts`
- Create: `docs/OPS.md` with monitoring setup

**Step 1: Verify the health route exists in the runtime app**

```bash
grep -n "health" apps/api/src/index.ts
```

Expected: a line registering a `/health` route. If absent, the route is only in `dump-openapi.ts` (the spec dump) and the running server has no health endpoint.

**Step 2: Add the route if missing**

Mirror the dump-openapi version. In `apps/api/src/index.ts`, after the `bearerAuth` registration:

```typescript
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  description: 'Returns 200 when the service is up.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }).openapi('HealthResponse'),
        },
      },
      description: 'Service is healthy',
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));
```

**Step 3: Sign up for Healthchecks.io**

1. Create account at <https://healthchecks.io>.
2. Create a new check: name "API uptime", schedule "every 5 minutes", grace "1 minute".
3. Copy the unique ping URL (looks like `https://hc-ping.com/<uuid>`).

**Step 4: Decide on the ping source**

Two options:

- **A: External HTTP probe.** Use Healthchecks.io's built-in scheduler — it pings YOUR API instead of you pinging it. Configure as "HTTP check" in the check settings. No extra infra.
- **B: Internal heartbeat.** A Supabase Edge Function on a `pg_cron` schedule curls `https://hc-ping.com/<uuid>` every 5 minutes. Catches deeper failures (DB unreachable from edge, etc.) than a black-box HTTP check.

Recommended: A initially (zero code), upgrade to B once Edge Functions exist.

**Step 5: Configure alert channels**

Healthchecks.io → Integrations → add email and (optional) Slack/Discord/Telegram. Test each by sending a test alert.

**Step 6: Document in `docs/OPS.md`**

Create `docs/OPS.md`:

```markdown
# Operations Runbook

## Monitoring

- **Uptime:** Healthchecks.io (account: <owner@>, check name "API uptime").
  - Alert channels: email + Slack #alerts.
  - To rotate the ping URL: create a new check, update DNS / cron, delete the old check.

## Health endpoint

`GET /v1/health` returns `{ "status": "ok" }` with HTTP 200. Used by:

- Healthchecks.io uptime check (every 5 min).
- Load balancer health probe (when deployed behind one).
- CI smoke test post-deploy (TODO).

## On call

- First responder: <owner email>
- Escalation: N/A (solo team)

## Common incidents

- **Health endpoint returns 5xx:** check Supabase status, recent deploys, error tracking (TODO).
- **Backup drill failed:** see `.github/workflows/backup-drill.yml` logs; if Supabase Management API is down, retry in 1 h.
```

**Step 7: Commit**

```bash
git add apps/api/src/index.ts docs/OPS.md
git commit -m "chore: register /v1/health route + document uptime monitoring"
```

**Done when:** Healthchecks.io shows the check as "up" and a manually triggered failure (return 503 from `/v1/health`) emails an alert within ~5 min.

---

## Closing notes

**Order of execution.** Tasks are independent — pick by launch-blocking severity, not numeric order. Suggested sequence as launch approaches:

1. Bundle size gate (Task 2) — before first deploy.
2. Transactional email (Task 3) — same day as auth middleware ships.
3. Health route + uptime monitoring (Task 5) — day of first deploy.
4. Backup-restore drill (Task 4) — once real customer data exists.
5. CODEOWNERS (Task 1) — when second contributor joins.

**Things deliberately not in this plan.**

- **Status page** (Statuspage.io / Better Uptime). Worth ~1 h once paying customers exist; until then the audience is one person.
- **Lighthouse CI / performance budgets.** Bundle size gate is a leading indicator; full Lighthouse CI is overkill until UX complaints surface.
- **PagerDuty / on-call rotation.** Solo team has no rotation; revisit when the team is ≥3.
- **Sentry / error tracking.** Belongs in Group 3 (production-ready), tracked separately. The backup-drill script's error handling assumes Sentry is NOT in place — if it lands first, wire failures into the same channel.
