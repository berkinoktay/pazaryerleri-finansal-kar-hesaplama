# Organization Onboarding — Milestone #2 Backlog

> **Status:** Not scheduled. Captures work explicitly deferred from Milestone #1 (PR #30) and open error-handling follow-ups from PR #34. When the time comes, each section below should be promoted to its own design/implementation plan in `docs/plans/` — this file is a reminder, not an execution plan.

**Context:** Milestone #1 shipped a single-owner onboarding: a user can sign up, create their first organisation (becoming OWNER), and switch between orgs they own. The commit message for PR #30 listed five items as deferred. Two more items surfaced in the PR #34 error-handling audit as "out of scope."

## Dependency chain

```
(4) requireRole middleware
       │
       ▼
(3) Member management endpoints  ─────┐
       │                               │
       ▼                               ▼
(1) Invite / accept flow          (future: audit-log, role-change rules)

(2) organization_billing  — independent, parallel-schedulable
(5) user_profiles account settings — cosmetic, last
```

Recommended sequencing: **4 → 3 → 1**, with **2** in parallel whenever faturalandırma becomes a business need. **5** last.

---

## 1. Invite / accept flow

**Why:** Today only the OWNER exists in an organisation. Without an invite path, the product is effectively single-user per tenant.

**Shape (to refine when scheduled):**

- `POST /v1/organizations/:orgId/invites` — OWNER/ADMIN creates an invite (email + role).
- `GET /v1/invites/:token` — public route, returns invite metadata for the accept page.
- `POST /v1/invites/:token/accept` — authenticated route; creates `OrganizationMember` row, revokes invite.
- Transactional email via Resend (see `docs/plans/2026-04-18-launch-readiness.md` Task 3 — ships first).
- New Prisma model `OrganizationInvite` (token, email, role, expires_at, revoked_at, invited_by).
- RLS: invites readable only by org OWNER/ADMIN; accept path goes through API (service-role write).

**Blocked on:** Task 4 (`requireRole`), Task 3 (member-mgmt endpoints for parity), transactional email infrastructure.

---

## 2. `organization_billing` table (VKN + subscription plan)

**Why:** Turkish B2B invoicing requires VKN (vergi kimlik numarası) + ünvan + adres. Subscription tier needs a home before paid plans exist.

**Shape:**

- New Prisma model `OrganizationBilling` (1:1 with Organization): `vkn`, `tax_office`, `legal_name`, `billing_address`, `plan` enum (FREE/PRO/ENTERPRISE), `plan_started_at`, `trial_ends_at`.
- Admin endpoint to read + update billing info (OWNER only).
- RLS: read requires membership; write requires OWNER role via `requireRole`.
- **Not** a payment-processor integration — that is a separate track. This table just holds what the business needs for invoicing and plan gating.

**Independent of** the 4 → 3 → 1 chain. Schedule when paid plans or proper invoices become a requirement.

---

## 3. Member management endpoints

**Why:** Once invites ship, OWNER needs to list members, change roles, and remove them.

**Shape:**

- `GET /v1/organizations/:orgId/members` — list members + roles (any member can read).
- `PATCH /v1/organizations/:orgId/members/:userId` — update role (OWNER only; cannot demote last OWNER).
- `DELETE /v1/organizations/:orgId/members/:userId` — remove member (OWNER only; cannot remove self if last OWNER; self-leave is a separate endpoint).
- Guard rails: at least one OWNER at all times — enforced in service layer, not just RLS.

**Blocked on:** Task 4 (`requireRole`).

---

## 4. `requireRole()` middleware

**Why:** Currently every authenticated org member can hit every org-scoped endpoint. No differentiation between OWNER / ADMIN / MEMBER. This primitive unlocks Tasks 1, 2, 3.

**Shape:**

- New factory in `apps/api/src/middleware/require-role.middleware.ts`: `requireRole('OWNER' | 'OWNER' | 'ADMIN')` returns Hono middleware that reads the org-context (already injected by `org-context.middleware.ts`), looks up the caller's `OrganizationMember.role`, and throws `ForbiddenError` on mismatch.
- Role hierarchy: `OWNER > ADMIN > MEMBER` — `requireRole('ADMIN')` lets OWNER through.
- Test pattern: extend the existing `apps/api/tests/integration/tenant-isolation/` matrix with per-role probes.

**Smallest first step** — tackle this before anything else in this file.

---

## 5. `user_profiles` account-settings fields

**Why:** Cosmetic — display name, avatar URL, phone. Nothing blocks on this; users show up today as their email.

**Shape:**

- Add columns to `user_profiles`: `full_name`, `avatar_url`, `phone`.
- `PATCH /v1/me` endpoint (self-update only, RLS handles isolation).
- Web: a `/settings/profile` page.

**Schedule:** last. Useful, not urgent.

---

## 6. `meta.requestId` stamping (N4 from PR #34)

**Why:** When a customer pastes an error message into support, we need a correlation ID to find the request in logs. `ARCHITECTURE.md` specifies `meta.requestId` on every response; enforcement is not in place.

**Shape:**

- Middleware generates a UUIDv7 per request, sets response header `x-request-id` and injects into ProblemDetails `meta.requestId`.
- Frontend `ApiError` already has a spot for `meta` — surface the request ID in the toast as small copy-to-clipboard text.
- Logging: every server log line includes the request ID (structured logger tbd).

---

## 7. Rate-limiting middleware

**Why:** `RateLimitedError` class and RFC 7807 mapping already ship (PR #34). The middleware that actually *throws* it does not exist — so the 429 + `Retry-After` path is untested against real traffic.

**Shape:**

- Likely a per-user + per-IP token bucket backed by Supabase Postgres (no extra infra) or Upstash Redis (if latency matters).
- Defaults: 60 req/min per user on writes, 300 req/min on reads. Tune after first real load.
- Emits `Retry-After` header via the already-wired `error.headers` pipe in `app.onError`.

---

## 8. Launch-time DB migration baseline

**Why:** `packages/db/prisma/migrations/` is empty (only `.gitkeep`) — every schema edit has gone through `prisma db push` so far. That is fine pre-launch (no users, no data to preserve), but `migrate deploy` against a production Supabase DB requires an ordered set of SQL migration files. Without a baseline, the first prod deploy has no rollback artifact and no schema-drift check.

**Shape (to flesh out when scheduling):**

- On the launch branch: `pnpm --filter @pazarsync/db exec prisma migrate dev --name baseline --create-only`. Prisma emits a single SQL file capturing the current schema (~11 tables + enums + RLS not captured — see note).
- Inspect the generated SQL; hand-merge the RLS policies from `supabase/sql/rls-policies.sql` either as a second migration file or keep them separate and stay on `db:apply-policies`.
- Deploy with `prisma migrate deploy` against prod; it creates the `_prisma_migrations` tracking table on first run.
- From that point forward, every schema change goes through `pnpm db:migrate` (delta migrations). `db:push` stays as a dev-only convenience.
- Update `CLAUDE.md` and `packages/db/README.md` to codify the split: `db:push` for local dev, `db:migrate` for anything that will ship.

**Blocks on:** first real production deployment. Until then, zero practical cost to deferring.

**Risk if shipped without:** first prod deploy has no ordered schema replay path; schema drift between environments surfaces only as runtime errors; rollbacks require ad-hoc `ALTER TABLE` by hand.

---

## When to promote an item from backlog to active plan

- The use case has become concrete (e.g. second team member joining → Task 1).
- A customer is blocked on it (e.g. B2B invoice request → Task 2).
- A security/compliance audit flagged it (e.g. no rate limiting → Task 7).

Until one of those triggers fires, leave these here — don't preemptively build out abstractions for flows with no users.
