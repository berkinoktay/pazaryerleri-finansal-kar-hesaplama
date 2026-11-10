# Rule map — judgment lens + authoritative sources

This is a **lens to direct attention**, not the law. The authoritative rule is
always the cited source file, which changes over time. When a category below is
in play and the exact rule matters, open the source and read the current text.
If you find a rule in the source that this map doesn't list, it still applies.

Format per row: **what to look for** · severity · **source of truth**.

## Architecture & data flow

- **No financial calculation on the frontend.** UI renders backend-computed
  values; never compute profit/VAT/commission/margin/Decimal money math in a
  component or feature. · 🔴 · design memory `feedback_no_frontend_financial_calculation`, root `CLAUDE.md` "Money"
- **Typed API client only.** No raw `fetch()` against the API. Calls live in
  `features/<f>/api/<f>.api.ts`, throw via `throwApiError`, are wrapped by a
  React Query hook in `hooks/`. · 🔴 (raw fetch) / 🟡 (structure) · `apps/web/CLAUDE.md` "Typed API Client"
- **Feature boundaries.** No `features/X` importing from `features/Y`. Shared
  symbols promote to `lib/` / `patterns/` / `@pazarsync/*`. Confirm a suspected
  `feature → feature` edge with `pnpm audit:boundaries` (the authoritative CI
  verdict). · 🔴 · root `CLAUDE.md` "Feature Boundaries"
- **No shared-layer → feature inversion.** A shared layer
  (`components/patterns/`, `components/`, `lib/`) must NOT import from
  `features/`. A generic `patterns/profit-cell.tsx` pulling a hook out of
  `features/account` chains the shared component to one feature and inverts the
  dependency direction. The audit script does NOT catch this (it only scans
  `feature → feature`) — find it by reading imports. Fix: move the shared symbol
  up to `providers/` / `lib/` / `patterns/`. · 🔴 · root `CLAUDE.md` "Feature Boundaries & Promotion Rules"
- **Default scope = selected store.** Operational views are store-scoped via the
  cookie-resolved active store, not org-wide. · 🟡 · design memory `feedback_default_scope_selected_store`

## React patterns

- **Server Components by default**; `'use client'` only when interactivity is
  needed. · 🟡 · `apps/web/CLAUDE.md` "React Best Practices"
- **No unnecessary `useEffect`.** Derive during render / `useMemo`; `useEffect`
  is only for syncing with external systems. · 🟡 · same
- **Composition over prop drilling** (3+ levels → context). · 🟡 · same
- **State hierarchy:** URL (nuqs) → server (React Query) → local (useState). No
  Zustand for server data, no Zustand without a concrete reason. · 🟡 · `apps/web/CLAUDE.md` "State Management Hierarchy"

## React Query

- **Query-key factory** per feature; no inline query keys. · 🟡 · `apps/web/CLAUDE.md` "TanStack React Query Conventions"
- **No hand-rolled toast** in hooks — global `onError` localizes from the error
  code; opt out only with `meta.silent` when the hook owns its UI. · 🟡 · root + `apps/web/CLAUDE.md` "Error Handling"
- `select` for transforms, `enabled` for conditional fetch (not effect+refetch),
  sensible `staleTime` (not `0` everywhere). · 🔵/🟡 · same

## Error handling

- **api functions throw via `throwApiError`** — never `new Error(JSON.stringify)`. · 🟡 · `apps/web/CLAUDE.md` "Error Handling"
- **New route segment that can throw needs `error.tsx`** wrapping the shared
  `ErrorFallback` (never forked). · 🔴 (missing) / 🟡 (forked) · same
- **VALIDATION_ERROR** surfaces field-level inline via `form.setError`, not a
  toast. · 🟡 · same

## CSS / Tailwind v4 (token-first)

- **No arbitrary values** (`bg-[#..]`, `p-[13px]`, `text-[14px]`) — extend tokens. · 🟡 · `apps/web/CLAUDE.md` "CSS & Tailwind"
- **No hard-coded hex/rgb** in component code; colors come from tokens. · 🟡 · same
- **No T3-era `max-w-(xs|sm|…|7xl)`** — collides with the spacing scale; use
  role tokens (`max-w-form`, `max-w-modal`, …). · 🟡 · `apps/web/CLAUDE.md` "max-w collision"
- **`cn()` for conditional classes**, never string concatenation. · 🟡 · same
- **No inline `style={{}}`** except runtime-dynamic values, each marked
  `// runtime-dynamic: <reason>`. · 🟡 · same
- **Alpha is a signal, not a style.** Repeated `/50`,`/30`,`/10` means a missing
  token — add a named surface/border token instead. · 🟡 · `apps/web/CLAUDE.md` "transparency discipline"
- **No new palette / second aesthetic.** One OKLCH system; marketing/auth/
  onboarding use it too. Extend via `/ui-design-system`. · 🟡 · `apps/web/CLAUDE.md` "Dashboard aesthetic is locked"
- **No left-border accent** on active nav/card — use soft surface fill or a
  right-side dot. · 🟡 · design memory `feedback_no_left_border_accent`

## Dark mode & SSR safety (`'use client'`)

- No reading `theme`/`resolvedTheme`/`localStorage`/`matchMedia` during render
  without a mount gate or CSS-only alternative. · 🔴 · `apps/web/CLAUDE.md` "SSR safety"
- No `new Date()` / `Date.now()` / `Math.random()` in the render path or at
  module scope of a client component. · 🔴 · same
- No nested interactive elements (Radix triggers ARE buttons). · 🔴 · same
- Date/number strings via `useFormatter()` with a named preset from
  `formats.ts`, never hand-rolled `Intl.DateTimeFormat`. · 🟡 · same
- Semantic tone contract: `text-<tone>` on `bg-<tone>-surface`; solid
  `bg-<tone>` uses `text-<tone>-foreground`. · 🟡 · `apps/web/CLAUDE.md` "Semantic tone contract"

## UI selection cascade & component architecture

- **Cascade order:** scan `patterns/` → `ui/` → shadcn registry → custom.
  Custom composes from `ui/`+`patterns/`, never raw HTML, never by forking. · 🟡 · `apps/web/CLAUDE.md` "UI Development Workflow"
- Feature components under `features/<f>/components/`; cross-feature composites
  promote to `components/patterns/`. · 🟡 · same
- **Config-driven UI** — map arrays for repeated elements; no copy-pasted cards. · 🔵 · `apps/web/CLAUDE.md` "Component Architecture"

## Next.js 16

- `params` / `searchParams` are async — `await` them. · 🟡 · `apps/web/CLAUDE.md` "Next.js 16 Specifics"
- Every page exports `metadata`. · 🟡 · same
- `proxy.ts` (not `middleware.ts`); new protected route → `PROTECTED` array. · 🟡 · same + "Route access rules"

## TypeScript discipline (shared)

- No `any`, no `as` assertion, no `@ts-ignore`/`@ts-expect-error`. · 🟡 · root `CLAUDE.md` "TypeScript Discipline"
- Exhaustive switch on unions with `default: never`; explicit return types on
  exported functions/hooks; `as const` for static config. · 🟡 · same
- **No magic numbers/strings**; marketplace values in config/DB, not inline. · 🟡 · root `CLAUDE.md` "No Hard-Coded Values" + memory `feedback_marketplace_parameters_data_driven`

## i18n & language

- **Turkish text always through next-intl**, never inline in components. · 🟡 · root + `apps/web/CLAUDE.md`
- New error code → translation in BOTH `tr.json` and `en.json`. · 🟡 · `apps/web/CLAUDE.md` "Adding a new error code"

## Performance

- `React.memo` only when profiled; `@tanstack/react-virtual` for lists >50;
  `next/image` with dimensions; dynamic import for heavy client libs. · 🔵 · `apps/web/CLAUDE.md` "Performance"

## Responsive / touch (mobile-first mandatory)

- Mobile-first; content-driven breakpoints (not device ladders); detect input
  method (`pointer: coarse`) for ≥44px touch targets. · 🟡/🔵 · `apps/web/CLAUDE.md` "Responsive, touch, and transparency discipline" + memory `feedback_always_mobile_responsive`

## Testing

- New custom React Query hook → MSW hook test. New form/interactive component →
  component test. New `lib/` util → unit test. · 🟡 · `apps/web/CLAUDE.md` "Testing" + root "Testing"
- No `getByTestId` first, no `fireEvent` for typing/clicking, no snapshot tests,
  no `environment: jsdom`, no mocking `@pazarsync/api-client`. · 🟡 · `apps/web/CLAUDE.md` "Forbidden patterns"

## Security (frontend)

- Role checks in UI are UX-only; never trust the client. Never display/request
  credentials. Never `console.log` sensitive data. Generic error copy (404 = "not
  found", not "no permission"). · 🔴 · `apps/web/CLAUDE.md` "Security Notes" + `docs/SECURITY.md`

## Env vars

- New env var → update `.env.example` + `turbo.json` + `ci.yml` together, plus
  boot-time `validateRequiredEnv()`. · 🟡 · memory `feedback_env_var_checklist`
