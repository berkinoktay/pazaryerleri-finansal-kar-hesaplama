# CLAUDE.md — PazarSync Frontend

> See also: root `CLAUDE.md` for shared coding standards, and `docs/ARCHITECTURE.md` for system architecture.

## CRITICAL: Security Notes

> **`docs/SECURITY.md` is mandatory reading** before working on auth, store management, credentials, or any data-display screens.
>
> Frontend-specific security rules:
>
> 1. **Never trust the client.** Role checks in the UI (e.g., hiding a delete button for VIEWER) are ONLY for UX — the backend enforces all permissions. Always assume an attacker can call the API directly.
> 2. **Never display credentials.** Store API credentials are write-only from the UI. Never request them back from the API for display, even masked.
> 3. **Never log sensitive data.** Don't `console.log` orders, customer info, or store credentials — browser logs persist and may leak via support screenshots.
> 4. **Show generic error messages.** Don't leak whether a resource exists in another tenant. Backend returns 404 for unauthorized access — display that as "not found", not "you don't have permission".
> 5. **Always use the typed API client.** Don't bypass with raw `fetch()` — the client handles auth headers, error parsing, and prevents accidental data exposure.
>
> See [`docs/SECURITY.md`](../../docs/SECURITY.md) for full system-wide rules.

## React Best Practices

- Server Components by default; `"use client"` only when interactivity is needed
- No unnecessary `useEffect` — compute derived state during render, use `useMemo` for expensive computations. `useEffect` is ONLY for syncing with external systems (WebSocket, DOM APIs, subscriptions)
- Composition over props drilling — if props pass through 3+ levels, use context
- Feature folders under `src/features/` — each feature owns its components, hooks, types, and API layer

```tsx
// ❌ Bad — useEffect to derive state
function OrderSummary({ orders }: { orders: Order[] }) {
  const [totalProfit, setTotalProfit] = useState(0);
  const [profitableCount, setProfitableCount] = useState(0);

  useEffect(() => {
    const profit = orders.reduce((sum, o) => sum + Number(o.netProfit), 0);
    setTotalProfit(profit);
    setProfitableCount(orders.filter((o) => Number(o.netProfit) > 0).length);
  }, [orders]);

  return (
    <div>
      {formatCurrency(totalProfit)} ({profitableCount} profitable)
    </div>
  );
}

// ✅ Good — derive during render
function OrderSummary({ orders }: { orders: Order[] }) {
  const totalProfit = useMemo(
    () => orders.reduce((sum, o) => sum.add(o.netProfit), new Decimal(0)),
    [orders],
  );
  const profitableCount = useMemo(() => orders.filter((o) => o.netProfit.gt(0)).length, [orders]);

  return (
    <div>
      {formatCurrency(totalProfit)} ({profitableCount} {t('orders.profitable')})
    </div>
  );
}
```

```tsx
// ❌ Bad — prop drilling through 4 levels
function StorePage({ storeId }: { storeId: string }) {
  const { data: store } = useStore(storeId);
  return (
    <StoreLayout store={store}>
      <OrderPanel store={store} />
    </StoreLayout>
  );
}
function OrderPanel({ store }: { store: Store }) {
  return <OrderFilters store={store} />;
}
function OrderFilters({ store }: { store: Store }) {
  return <PlatformBadge platform={store.platform} />;
}

// ✅ Good — context at the boundary
function StorePage({ storeId }: { storeId: string }) {
  return (
    <StoreProvider storeId={storeId}>
      <StoreLayout>
        <OrderPanel />
      </StoreLayout>
    </StoreProvider>
  );
}
function OrderFilters() {
  const { store } = useStoreContext();
  return <PlatformBadge platform={store.platform} />;
}
```

## State Management Hierarchy

Use the simplest option that fits. No Zustand unless justified with a concrete reason.

```
URL state (nuqs)           → filters, pagination, selected tab, store selection
Server state (React Query) → orders, products, settlements, dashboard data
Local state (useState)     → modal open/close, form draft, UI toggles
```

```tsx
// ❌ Bad — Zustand store for server data
const useOrderStore = create((set) => ({
  orders: [],
  fetchOrders: async () => { ... },
}));

// ✅ Good — React Query for server state, nuqs for URL state
const [status, setStatus] = useQueryState('status', parseAsString);
const { data: orders } = useOrders(storeId, { status });
```

## Auth (Supabase SSR)

Three Supabase client flavors — different execution contexts, different cookie access APIs:

| Use from                                     | Import                                              |
| -------------------------------------------- | --------------------------------------------------- |
| Client Components                            | `createClient` from `@/lib/supabase/client`         |
| Server Components / Actions / Route Handlers | `createClient` from `@/lib/supabase/server` (async) |
| `proxy.ts` middleware                        | `updateSession` from `@/lib/supabase/middleware`    |

Mixing them up causes silent session desync (cookies written by one context don't round-trip through the other). When in doubt: browser client in `'use client'` files, server client everywhere else.

### Session refresh + route guard

`proxy.ts` runs before every server render. It calls `updateSession()` to rotate near-expiry tokens (writing fresh cookies onto the response), then makes redirect decisions:

- Unauthenticated request to `/dashboard` or `/onboarding` → 307 to `/login?redirect=<original>`.
- Authenticated request to `/login` or `/register` → 307 to `/dashboard`.

Adding a new protected route: append its path to the `PROTECTED` array in `proxy.ts`. Adding a guest-only route (e.g., a future `/reset-password`): append to `GUEST_ONLY`.

### API calls — apiClient injects the Bearer token

Client Components import `apiClient` from `@/lib/api-client/browser`. The middleware in `makeApiClient` reads the current session from the browser Supabase client and attaches `Authorization: Bearer <jwt>` on every request.

Server Components / Server Actions / Route Handlers call `getServerApiClient()` from `@/lib/api-client/server` per request (not at module scope — cookies are request-scoped; caching across requests would cross-leak sessions).

```typescript
// ❌ Bad — raw fetch without auth
const res = await fetch('/api/orders');

// ❌ Bad — using server client in a Client Component
('use client');
import { getServerApiClient } from '@/lib/api-client/server'; // will throw

// ✅ Good — Client Component
('use client');
import { apiClient } from '@/lib/api-client/browser';
const { data } = await apiClient.GET('/v1/organizations', {});

// ✅ Good — Server Component
import { getServerApiClient } from '@/lib/api-client/server';
const api = await getServerApiClient();
const { data } = await api.GET('/v1/organizations', {});
```

### Sign-in / sign-out pattern

`useSignIn()` and `useSignOut()` in `@/features/auth/hooks/*` are the only entry points. Never call `supabase.auth.signInWithPassword` directly in a component — route through the hook so `router.refresh()` fires and the proxy sees the cookie change on the next request.

## TanStack React Query Conventions

- No raw `fetch()` in components — all data fetching through custom hooks wrapping `useQuery`/`useMutation`
- Custom hooks per feature: `useOrders()`, `useCreateOrder()`, `useUpdateProductCost()`, etc.
- Query keys MUST use a factory pattern for consistency and safe invalidation
- Optimistic updates with `onMutate`/`onError`/`onSettled` for user-facing mutations
- `enabled` flag for conditional fetching, not useEffect + refetch
- `select` for data transformation, not in component body
- Sensible `staleTime` defaults in QueryClient config — don't set `staleTime: 0` everywhere
- Prefetch on hover/focus for navigation-heavy UIs
- All API calls go through the **typed openapi-fetch client** (see subsection below); never raw `fetch()`

### Typed API Client

All API calls go through `apiClient`, an `openapi-fetch` instance defined in `apps/web/src/lib/api-client.ts`. The client is typed by the `paths` and `components` interfaces exported from `@pazarsync/api-client`, which is regenerated from `apps/api`'s OpenAPI spec.

- **Never** use raw `fetch()` against the API — the typed client gives autocomplete on paths, params, request bodies, and responses, plus a discriminated `{ data, error }` result.
- **Path keys are `/v1/...`** in the generated `paths` interface because `@hono/zod-openapi` inlines the backend's `basePath("/v1")`. Pair with a frontend `baseUrl` that does NOT include `/v1`.
- **Response body types** come from `components["schemas"]["..."]` — one source of truth, generated from the backend Zod schemas.
- API call functions live in `src/features/<feature>/api/<feature>.api.ts` and are wrapped by React Query hooks in `hooks/`.
- After backend route changes, run `pnpm api:sync` from the repo root to refresh both the spec snapshot and the generated types; TypeScript surfaces breakage immediately.

```typescript
// apps/web/src/features/organization/api/organizations.api.ts
import type { components } from '@pazarsync/api-client';
import { apiClient } from '@/lib/api-client';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await apiClient.GET('/v1/organizations', {});
  if (error) {
    throw new Error(`Failed to fetch organizations: ${JSON.stringify(error)}`);
  }
  return data.data;
}
```

```typescript
// ✅ Query key factory — every feature MUST have one
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: OrderFilters) => [...orderKeys.lists(), filters] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
};

// Usage in hooks
useQuery({ queryKey: orderKeys.list({ storeId, status }), queryFn: ... });

// Safe invalidation — invalidates all order lists without touching details
queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
```

```typescript
// ❌ Bad — raw fetch in component, inline query key, untyped response
function OrderList({ storeId }: { storeId: string }) {
  const { data } = useQuery({
    queryKey: ['orders', storeId],
    queryFn: () => fetch(`/api/v1/organizations/${orgId}/stores/${storeId}/orders`)
      .then(res => res.json()),
  });
  const filteredOrders = data?.filter((o: any) => o.status === 'DELIVERED');
  return <DataTable data={filteredOrders} />;
}

// ✅ Good — custom hook, factory key, typed API client, select for transform
function OrderList({ storeId }: { storeId: string }) {
  const { data: orders } = useOrders(storeId, {
    status: 'DELIVERED',
    select: (data) => data.sort((a, b) => b.orderDate.localeCompare(a.orderDate)),
  });
  return <DataTable data={orders} />;
}

// In features/orders/api/orders.api.ts — thin wrapper over the typed client
import type { components } from "@pazarsync/api-client";
import { apiClient } from "@/lib/api-client";

export type Order = components["schemas"]["Order"];

export async function listOrders(
  orgId: string,
  storeId: string,
  filters: { status?: Order["status"] },
): Promise<Order[]> {
  const { data, error } = await apiClient.GET(
    "/v1/organizations/{orgId}/stores/{storeId}/orders",
    { params: { path: { orgId, storeId }, query: filters } },
  );
  if (error) throw new Error(`Failed to fetch orders: ${JSON.stringify(error)}`);
  return data.data;
}

// In features/orders/hooks/use-orders.ts — React Query layer, keyed via factory
export function useOrders(
  storeId: string,
  options?: { status?: Order["status"]; select?: (data: Order[]) => Order[] },
): UseQueryResult<Order[]> {
  const { orgId } = useOrgContext();
  const filters = { storeId, status: options?.status };

  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => listOrders(orgId, storeId, { status: options?.status }),
    select: options?.select,
  });
}
```

## CSS & Tailwind

- Tailwind v4 with token-first design system. Token definitions live in `src/app/tokens/*.css`; `globals.css` wires them through `@theme inline`. **Never add arbitrary values in component code** — if a value is missing, extend the token system.
- `cn()` for conditional classes, never string concatenation
- No inline `style={}` except truly runtime-dynamic values (progress bar width, drag offsets). Mark each with a `// runtime-dynamic: <reason>` comment so code review can distinguish legitimate cases from violations.
- Mobile-first responsive design
- Turkish text always through i18n (next-intl), never inline
- Raw shadcn/ui primitives live in `src/components/ui/`. All feature code imports from there — never fork a primitive to "tweak" styles; extend the token layer or add a pattern wrapper in `src/components/patterns/` instead.

### Tailwind v4 token namespaces (load-bearing)

Tailwind v4 maps named utility classes to CSS custom properties by namespace. The full list:

| Namespace         | Drives utilities                                                   |
| ----------------- | ------------------------------------------------------------------ |
| `--color-*`       | `bg-*`, `text-*`, `border-*`, `fill-*`, `ring-*`                   |
| `--font-*`        | `font-sans`, `font-mono`                                           |
| `--text-*`        | `text-xs`, `text-base`, `text-md`, `text-2xl`, ...                 |
| `--font-weight-*` | `font-medium`, `font-semibold`, ...                                |
| `--tracking-*`    | `tracking-tight`, `tracking-wide`                                  |
| `--radius-*`      | `rounded-sm`, `rounded-md`, `rounded-lg`, ...                      |
| `--shadow-*`      | `shadow-xs`, `shadow-md`, `shadow-lg`                              |
| `--ease-*`        | `ease-out-quart`, `ease-out-expo`                                  |
| `--duration-*`    | `duration-fast`, `duration-base`, `duration-slow`                  |
| `--spacing-*`     | `p-*`, `m-*`, `gap-*`, `w-*`, `h-*`, `min-w-*`, **`max-w-*`**, ... |

Reference: https://tailwindcss.com/docs/theme

**CRITICAL gotcha — `max-w-*` collision.** In Tailwind v4 the `--spacing-*` namespace drives both spacing (`p-md`) and sizing utilities (`max-w-md`). Our design system defines a semantic spacing scale (`--space-xs` … `--space-5xl`). Without care, `max-w-md` resolves to `16px` (our `--space-md`), not `28rem`. Never use the T3-era `max-w-(xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)` names — ESLint blocks them. Use role-based domain tokens instead:

```
max-w-input-narrow  →  20rem  (320px) · single short field
max-w-input         →  24rem  (384px) · search / text field column
max-w-form          →  28rem  (448px) · form column
max-w-sheet         →  24rem  (384px) · slide-over sheet (mobile)
max-w-sheet-wide    →  28rem  (448px) · slide-over sheet (sm+)
max-w-modal         →  32rem  (512px) · dialog content
max-w-headline      →  56rem  (896px) · landing hero H1 column
max-w-content-max   →  1440px        · page body cap
max-w-prose-max     →  68ch          · readable prose column
```

If a new role emerges, add it to `src/app/tokens/spacing.css` (as `--size-<role>`) and consume it as `max-w-<role>`. Do not reach for `max-w-[32rem]`.

```tsx
// ❌ Bad — string concatenation, arbitrary values, inline styles, Tailwind T3-era max-w names
function ProfitBadge({ profit }: { profit: Decimal }) {
  const isPositive = profit.gt(0);
  return (
    <span
      className={
        'rounded px-2 py-1 text-sm ' +
        (isPositive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')
      }
      style={{ minWidth: '73px', marginLeft: '13px' }}
    >
      {formatCurrency(profit)}
    </span>
  );
}

// ✅ Good — cn(), token utilities, no inline styles, semantic tones
function ProfitBadge({ profit }: { profit: Decimal }) {
  return (
    <span
      className={cn(
        'ml-sm px-xs py-3xs text-2xs rounded-full font-medium tabular-nums',
        profit.gt(0)
          ? 'bg-success-surface text-success'
          : 'bg-destructive-surface text-destructive',
      )}
    >
      {formatCurrency(profit)}
    </span>
  );
}
```

### Responsive, touch, and transparency discipline

Three additional guardrails that extend the token-first rule above. Each is grep-able in code review.

**1. Content-driven breakpoints, not device-ladders.** Don't add breakpoints because a phone/tablet/desktop "should" have one — add them where the content actually starts to break. Start narrow, widen the viewport until alignment, line length, or hierarchy fails, add a breakpoint there. Three is usually enough (`sm`, `md`, `lg`). `clamp()` and `auto-fit` grids reduce the need for breakpoints entirely. Anti-pattern: a component with `sm: md: lg: xl: 2xl:` variants that only re-tile at two of them — the rest are noise.

**2. Detect input method, not just viewport.** Touch devices can't hover, and a desktop user with a stylus can have a small viewport. Use `@media (pointer: coarse)` to widen touch targets and swap hover affordances for always-visible ones, independent of breakpoint. Critical for tables/toolbars where 32–36px icon buttons are fine with a mouse but fail the 44px rule under finger. Pair with `@media (hover: hover)` when a hover-reveal is only safe on pointer devices.

```tsx
// ✅ Good — touch target expands under finger regardless of viewport width
<button className={cn(
  'size-8 rounded-md',                 // 32px — fine for mouse
  'pointer-coarse:size-11',            // 44px — required for touch
)}>
```

If `pointer-coarse:` isn't wired as a Tailwind variant yet, extend the theme before reaching for an arbitrary `@media` block.

**3. Transparency is a signal, not a style.** Heavy reliance on alpha (`bg-*/30`, `ring-*/40`, `border-*/10`) almost always means the palette is missing a step. Before writing `bg-muted/50`, ask: "is this a new semantic surface I need?" If yes, add a named token (`--surface-subtle`, `--overlay-scrim`). Reserve alpha for cases where the value behind is genuinely dynamic — scrims over photography, blur-behind overlays, hover tints on interactive rows.

```tsx
// ❌ Bad — alpha as a palette shortcut
<div className="border-white/10 bg-black/5" />

// ✅ Good — named token; the alpha only lives in the token definition
<div className="border-border bg-muted" />

// ✅ Acceptable — genuinely runtime-dynamic backdrop
<div className="bg-background/80 backdrop-blur-sm" /> {/* scrim over scrolling content */}
```

Rule of thumb: if you wrote `/<number>` more than once in the same component, you need a token.

### Dark-mode discipline

Dark mode is a separate design, not an inversion. Four rules keep it from decaying into the classic "black surface, barely-visible card" failure mode. Each came from a real bug caught in the showcase audit — the whys are in the token files.

**1. Raised surfaces need both outer shadow AND inset top highlight.** In dark mode, a pure-black outer shadow (`0 2px 6px oklch(0% 0 0 / 0.1)`) on a dark background is functionally invisible — there's nothing darker than black to read as "lifted." Linear/Stripe/Ramp solve this by stacking a stronger outer shadow with an inset top highlight (`inset 0 1px 0 0 oklch(100% 0 0 / 0.04-0.07)`) that simulates light catching the top edge. All `--shadow-*` tokens in `tokens/shadow.css` already include this for `.dark`. Never hand-roll shadows in component code — extend the token.

**2. Semantic tone contract: `text-<tone>` on `bg-<tone>-surface`, solid `bg-<tone>` uses `text-<tone>-foreground`.** The four semantic tones (`success`, `warning`, `destructive`, `info`) each ship three tokens:

| Use case                      | Pair                                   |
| ----------------------------- | -------------------------------------- |
| Chip / alert / tinted callout | `bg-<tone>-surface` + `text-<tone>`    |
| Solid button / filled bar     | `bg-<tone>` + `text-<tone>-foreground` |
| Icon on neutral bg            | `text-<tone>`                          |

`text-<tone>-foreground` is a near-white (or near-dark in dark mode) designed for solid `bg-<tone>` contrast. Using it on `bg-<tone>-surface` (which is a heavily-desaturated tint of the same hue) produces a near-invisible foreground — the exact warning badge failure we shipped and reverted. Keep all four tones consistent — if you change one (e.g. badge warning), change all four or the system drifts.

The `text-<tone>` color itself must clear ≥4.5:1 against both neutral backgrounds (`bg-background`, `bg-card`) AND its own `bg-<tone>-surface` in both light and dark modes. If the only way to make it clear surface contrast in one mode is to make it illegible in the other, redo the token (we darkened light `--warning` from `70%` → `55%` for exactly this reason).

**3. Chart series must read color from `--color-<key>`, not raw `--chart-N`.** `ChartContainer` config already wires series colors through CSS custom properties that swap per theme:

```tsx
// ❌ Bad — hard-codes the light-mode token, ignores dark-mode chart palette
<Line stroke="var(--chart-3)" />;

// ✅ Good — resolves through ChartContainer, picks up .dark overrides
const CONFIG = { margin: { label: 'Marj %', color: 'var(--chart-3)' } } satisfies ChartConfig;
<Line stroke="var(--color-margin)" />;
```

Area-chart `fillOpacity` is inherently mode-sensitive: a 0.15 alpha that reads as a gentle tint on white reads as nearly nothing on near-black. Leave strokes as the primary signal; if the fill matters for comparison, either raise opacity in dark mode via a CSS variable (`--area-fill-opacity`) or accept that dark-mode area fills are subtler and lean on legend + tooltip.

**4. Alpha shortcuts (`/50`, `/30`, `/10`) are a dark-mode trap.** Alpha on a light bg produces a predictable tint; the same alpha on a dark bg produces a nearly-black mud that reads flat. Whenever you feel the urge to write `bg-muted/50`, add the named surface token (`--surface-subtle`, `--border-muted`, `--muted-foreground-dim`) and consume it as a proper utility. The token's alpha (if any) lives in its definition, once, per theme. This is already the rule in the transparency section above — the dark-mode failure pattern is just the most visible reason.

### Design system showcase

The live reference for every token, primitive, and pattern lives under `/design/*`:

- `/design/tokens` — colors, typography, spacing, radius, shadow, motion (live swatches)
- `/design/primitives/*` — every shadcn primitive with variants and states
- `/design/patterns` — PazarSync-specific composites (KpiTile, TrendDelta, Currency, SyncBadge, PageHeader, EmptyState)
- `/design/data` — DataTable with filters, sorting, selection, import/export
- `/design/layout-demo` — dual-rail AppShell with mock store data

Before building a new screen, check the showcase to see what's already available. Before tweaking styles on a primitive, check whether the change belongs at the token layer (affects the whole system) or whether a pattern wrapper is the right home.

## Next.js 16 Specifics

- `params` and `searchParams` are async — always `await` them
- Use `proxy.ts` instead of `middleware.ts` for request interception
- Turbopack is the default bundler — no config needed
- Parallel routes require explicit `default.tsx` files
- All pages must export `metadata` for SEO
- Form state with React Hook Form + Zod resolver

```tsx
// ❌ Bad — sync params access (Next.js 15 pattern)
export default function OrderPage({ params }: { params: { id: string } }) {
  return <OrderDetail orderId={params.id} />;
}

// ✅ Good — async params (Next.js 16)
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail orderId={id} />;
}
```

```tsx
// ❌ Bad — no metadata export
export default function ProductsPage() { ... }

// ✅ Good — metadata for SEO
export const metadata: Metadata = {
  title: 'Urunler | PazarSync',
  description: 'Magaza urunlerinizi ve maliyet bilgilerini yonetin',
};

export default function ProductsPage() { ... }
```

## Component Architecture

Each feature follows this structure:

```
src/features/orders/
├── components/           # Feature-specific components
│   ├── orders-table.tsx
│   ├── order-detail.tsx
│   └── order-filters.tsx
├── hooks/               # Feature-specific hooks
│   ├── use-orders.ts    # React Query hooks
│   └── use-order-filters.ts
├── api/                 # API call functions
│   └── orders.api.ts    # fetch functions used by hooks
└── types.ts             # Feature-specific types (if not in @pazarsync/types)
```

- Config-driven UI — map arrays for repeated elements, define shape once

```tsx
// ❌ Bad — copy-pasted dashboard cards
<Card><CardTitle>Toplam Ciro</CardTitle><CardValue>{formatCurrency(data.revenue)}</CardValue></Card>
<Card><CardTitle>Net Kar</CardTitle><CardValue>{formatCurrency(data.netProfit)}</CardValue></Card>
<Card><CardTitle>Siparis Sayisi</CardTitle><CardValue>{data.orderCount}</CardValue></Card>

// ✅ Good — config-driven, map once
const DASHBOARD_METRICS = [
  { key: 'revenue', labelKey: 'dashboard.revenue', format: formatCurrency },
  { key: 'netProfit', labelKey: 'dashboard.netProfit', format: formatCurrency },
  { key: 'orderCount', labelKey: 'dashboard.orderCount', format: formatNumber },
] as const;

{DASHBOARD_METRICS.map(({ key, labelKey, format }) => (
  <Card key={key}>
    <CardTitle>{t(labelKey)}</CardTitle>
    <CardValue>{format(data[key])}</CardValue>
  </Card>
))}
```

## Performance

- `React.memo` only when profiled and measured — never preemptive
- `@tanstack/react-virtual` for lists > 50 items
- Always `next/image` with proper dimensions
- Dynamic import for large client-side libraries (charts, editors)
- Error boundaries (`error.tsx`) on every route segment
- `Decimal.js` for monetary calculations, never floating point

```tsx
// ❌ Bad — importing heavy chart library at page level
import { BarChart, LineChart, PieChart } from 'recharts';

// ✅ Good — dynamic import, loaded only when visible
const ProfitChart = dynamic(() => import('@/features/profitability/components/profit-chart'), {
  loading: () => <ChartSkeleton />,
});
```

## Testing

Frontend tests live in `apps/web/tests/`, organized by category:

```
apps/web/tests/
├── unit/                   # Hook tests, pure utility tests
├── component/              # React component tests via RTL
└── helpers/                # render, msw
```

### Stack

- **Vitest** — test runner
- **happy-dom** — DOM environment (NOT jsdom — see Forbidden patterns below)
- **@testing-library/react** — component rendering
- **@testing-library/user-event** — typing, clicking (preferred over `fireEvent`)
- **@testing-library/jest-dom** — DOM matchers (`toBeInTheDocument`, etc.)
- **MSW (Mock Service Worker)** — intercepts HTTP at the network layer

### When tests are required

| Change                                                | Required test                             |
| ----------------------------------------------------- | ----------------------------------------- |
| New custom React Query hook in `features/*/hooks/`    | Hook test using MSW (`tests/unit/hooks/`) |
| New form component (validation, error states)         | Component test (`tests/component/`)       |
| New interactive component (modal, wizard, multi-step) | Component test                            |
| New utility in `lib/`                                 | Unit test                                 |

NOT required (over-testing slows iteration):

- Pure presentational components (`<Card>`, `<Badge>`, layout primitives)
- shadcn/ui re-exports
- Trivial layout/wrapper components

### Pattern reference

Full patterns in `docs/TESTING.md`. The most important ones:

- **Hook tests use MSW**, never mock `apiClient`. The whole point of the typed client is end-to-end type safety from backend Zod → frontend hook. Mocking `apiClient` defeats this.
- **Custom render wrapper**: use `render` from `tests/helpers/render.tsx` — provides `QueryClientProvider` and a `user` instance for `userEvent`.
- **MSW handlers**: defaults in `tests/helpers/msw.ts`. Per-test overrides via `server.use(http.get(...))`.

### Forbidden patterns

- ❌ Switching back to `environment: "jsdom"` — jsdom 29 isolates fetch in its own per-realm context, so MSW v2's `setupServer` never sees requests issued from the test. Hook tests will hang. happy-dom uses Node's native fetch which MSW intercepts cleanly.
- ❌ Mocking `@pazarsync/api-client` directly — use MSW
- ❌ `getByTestId` as the first choice — use `getByRole` (accessibility-first)
- ❌ `fireEvent` for typing/clicking — use `userEvent`
- ❌ Snapshot tests — fragile, hide intent
- ❌ Testing internal state — assert on what the user sees, not implementation

## No Utility Duplication

Before writing a new utility, check `packages/utils/src/` first. If it's frontend-only (e.g., React hooks, DOM helpers), put it in `apps/web/src/lib/`. If it's shared (currency, date, validation), it goes in `@pazarsync/utils`.
