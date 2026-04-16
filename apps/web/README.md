# @pazarsync/web

Next.js 16 frontend for PazarSync. Multi-tenant dashboard for Turkish marketplace sellers — orders, products, profitability, settlement reconciliation.

> **Coding rules: [`CLAUDE.md`](./CLAUDE.md)** — mandatory reading before touching this app. Covers React Query conventions, the typed API client, MSW patterns, Next.js 16 specifics, and forbidden patterns (e.g. why we use happy-dom over jsdom).

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **UI:** React 19.2 · Tailwind CSS 4 · shadcn/ui · Hugeicons
- **State:** TanStack React Query v5 (server) · `nuqs` (URL) · `useState` (local)
- **Forms:** React Hook Form + Zod resolver
- **API:** Typed `openapi-fetch` client from [`@pazarsync/api-client`](../../packages/api-client) — never raw `fetch()`
- **i18n:** `next-intl` — Turkish UI strings always through translations
- **Money:** `decimal.js` — never floating point
- **Testing:** Vitest · happy-dom · React Testing Library · MSW v2

## Develop

From the repo root:

```bash
pnpm dev --filter web       # http://localhost:3000
```

Standalone (inside `apps/web/`):

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm test                   # all frontend tests
pnpm test:unit              # hook tests (MSW-backed)
pnpm test:component         # component tests (RTL + userEvent)
```

## Folder Layout

```
src/
├── app/                    Next.js App Router (pages, layouts, route handlers)
├── features/               Feature folders — each owns components/, hooks/, api/, types
├── lib/                    Frontend-only utilities (api-client, cn, etc.)
└── i18n/                   next-intl config + translations

tests/
├── unit/                   Hook tests via MSW
├── component/              Component tests via RTL + userEvent
└── helpers/                render wrapper, MSW server setup
```

## Environment

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3001
```

See repo-root [`.env.example`](../../.env.example) for the full set.
