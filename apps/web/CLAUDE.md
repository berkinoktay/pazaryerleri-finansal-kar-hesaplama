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

### Auth flow hooks (the only entry points)

All Supabase Auth operations go through hooks in `@/features/auth/hooks/*`. Never call `supabase.auth.*` directly in a component — the hooks wrap `router.refresh()` (so the proxy re-evaluates session on next request) and query-cache invalidation (so the next render starts fresh).

| Flow                | Hook                | Redirect target                    |
| ------------------- | ------------------- | ---------------------------------- |
| Sign in             | `useSignIn`         | `?redirect=<x>` or `/dashboard`    |
| Sign up             | `useSignUp`         | `/check-email`                     |
| Sign out            | `useSignOut`        | `/login`                           |
| Forgot password     | `useForgotPassword` | (no redirect; inline "email sent") |
| Reset password      | `useResetPassword`  | `/dashboard`                       |
| Current user (read) | `useCurrentUser`    | n/a                                |

### Email callback

`/auth/callback` (Route Handler, outside `[locale]` group) receives Supabase redirects from confirmation / recovery / magic-link emails. It reads the `?code=` query param, exchanges for a session, and redirects to `?next=...` or `/dashboard`. The URL stays stable across locales because Supabase Dashboard config depends on it.

### Session expired

`SessionExpiredHandler` (mounted under `NextIntlClientProvider` in `[locale]/layout.tsx`) subscribes to the `AUTH_SESSION_EXPIRED` event dispatched by the apiClient when the backend returns 401. Any 401 response globally triggers: sign out → cache clear → toast → redirect to `/login`. A ref guard keeps parallel-request 401s from firing the flow multiple times.

### Route access rules (proxy.ts)

Two lists in `apps/web/src/proxy.ts` drive every gate:

- `PROTECTED` — `/dashboard`, `/onboarding`, `/auth/verified`. Anonymous hits → `/login?redirect=<path>`.
- `GUEST_ONLY` — `/login`, `/register`, `/check-email`, `/forgot-password`. Authenticated hits → `/dashboard`. (`/reset-password` deliberately isn't guest-only — recovery-session users need access to finish setting their new password.)

| Page               | Anonymous                 | Authenticated                        |
| ------------------ | ------------------------- | ------------------------------------ |
| `/login`           | ✓                         | → /dashboard                         |
| `/register`        | ✓                         | → /dashboard                         |
| `/check-email`     | ✓                         | → /dashboard                         |
| `/forgot-password` | ✓                         | → /dashboard                         |
| `/reset-password`  | form shows "invalid link" | ✓ (expected use is recovery session) |
| `/auth/callback`   | ✓ entry                   | ✓ entry                              |
| `/auth/verified`   | → /login                  | ✓ (countdown)                        |
| `/dashboard`       | → /login                  | ✓                                    |
| `/onboarding`      | → /login                  | ✓                                    |

### Form hardening

Every auth form is `<form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>`.

- `method="post"` — if JS ever fails to hydrate, native submission goes as a POST body instead of a GET with fields in the URL. Prevents credential leakage into browser history, access logs, and Referer headers.
- `noValidate` — disables the browser's built-in validation bubble so the zod-driven `FormMessage` remains the single source of field-error UI.
- `onSubmit={form.handleSubmit(...)}` — react-hook-form preventDefaults internally.

Never omit `method="post"` on an auth form; it's the last line of defense for a JS-broken edge case.

### Supabase redirect allowlist

`supabase/config.toml::site_url` + `additional_redirect_urls` must include every host:port the app is served on. Both `http://localhost:3000` and `http://127.0.0.1:3000` are listed because browsers may land on either. A mismatch causes Supabase to silently fall back to `site_url` — the symptom is "email confirmation link opens the landing page instead of /auth/callback". Restart Supabase after editing (`supabase stop && supabase start`).

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

**All api functions MUST throw via `throwApiError` — never `new Error(JSON.stringify(error))`. The helper preserves `status`, `code`, and `problem.errors[]` for hooks and forms to branch on.** See `apps/web/src/lib/api-error.ts` for the `ApiError` class.

```typescript
// apps/web/src/features/organization/api/organizations.api.ts
import type { components } from '@pazarsync/api-client';
import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations', {});
  if (error !== undefined) throwApiError(error, response);
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
import { apiClient } from "@/lib/api-client/browser";
import { throwApiError } from "@/lib/api-error";

export type Order = components["schemas"]["Order"];

export async function listOrders(
  orgId: string,
  storeId: string,
  filters: { status?: Order["status"] },
): Promise<Order[]> {
  const { data, error, response } = await apiClient.GET(
    "/v1/organizations/{orgId}/stores/{storeId}/orders",
    { params: { path: { orgId, storeId }, query: filters } },
  );
  if (error !== undefined) throwApiError(error, response);
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

## Error Handling

Frontend mirrors the backend's RFC 7807 contract end-to-end. Three concrete primitives + one global layer; every feature reuses them.

### Primitives

| Primitive                                               | Responsibility                                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ApiError` (`@/lib/api-error`)                          | Extends `Error` with `status`, `code`, `detail`, `problem`. Single type every hook receives.             |
| `throwApiError(error, response)` (`@/lib/api-error`)    | Converts openapi-fetch's `{ error, response }` pair into a thrown `ApiError`. Use in every `.api.ts`.    |
| `supabaseAuthErrorKey(err)` (`@/features/auth/lib/...`) | Maps `AuthApiError.code` to an i18n sub-key under `auth.errors.supabase.*`. One helper, every auth form. |

**Every api function MUST throw via `throwApiError`** — never `new Error(JSON.stringify(error))`. The helper preserves `.code` and `problem.errors[]` for hooks and forms to branch on. See the pattern in the "Typed API Client" section above.

### Global pipeline — `QueryProvider`

`apps/web/src/providers/query-provider.tsx` registers `QueryCache({ onError })` and `MutationCache({ onError })` that toast localized messages for any unhandled `ApiError`.

> **Provider hierarchy matters.** `QueryProvider` calls `useTranslations('common.errors')` internally, so it MUST be mounted BELOW `NextIntlClientProvider`. The canonical mount point is `apps/web/src/app/[locale]/layout.tsx` — not the root `app/layout.tsx`. Unit tests passed with a local `<NextIntlClientProvider><QueryProvider>` wrapper, but the runtime app previously had them inverted and ran into `Failed to call useTranslations because the context from NextIntlClientProvider was not found` during SSR. When adding a new provider that depends on i18n, mount it under `[locale]/layout.tsx` or you will hit the same runtime failure.

- Looks up `common.errors.<code>` in next-intl → Turkish toast via sonner
- **Silences** `UNAUTHENTICATED` (handled by `SessionExpiredHandler` — sign-out + redirect)
- **Silences** `VALIDATION_ERROR` (forms render field-level inline errors via `form.setError`)
- **Silences** `NETWORK_ERROR` when `navigator.onLine === false` (handled by `NetworkStatusBanner` — persistent top banner + auto-invalidate on reconnect)
- **Retry policy** bails immediately on 4xx; one retry for 5xx / network

```tsx
// ❌ Bad — hand-rolls a generic toast inside every hook
useMutation({ mutationFn: x, onError: () => toast.error(t('generic')) });

// ✅ Good — let the global onError do its job
useMutation({ mutationFn: x });
```

**Opt out with `meta.silent`** when a hook renders its own error UI (e.g. an auth form with a specific message, `useSignOut` with a dedicated "Couldn't sign out" toast):

```tsx
useMutation({
  mutationFn: signOut,
  onError: () => toast.error(tErr('auth.signOut.error')),
  meta: { silent: true }, // stops the global onError from stacking a second toast
});
```

For display-only queries (`useCurrentUser`, `useMe`) whose failures are cosmetic, set `meta: { silent: true }` on the `useQuery` config.

### Adding a new error code

1. Add the backend class + `problemDetailsForError` branch (see `apps/api/CLAUDE.md` — Error Responses).
2. Add the translation in BOTH `apps/web/messages/tr.json` AND `en.json` under the right namespace:
   - **`common.errors.<CODE>`** — pan-app codes (UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, VALIDATION_ERROR, INVALID_REFERENCE, RATE_LIMITED, INTERNAL_ERROR, NETWORK_ERROR, UNKNOWN_ERROR, generic)
   - **`auth.errors.supabase.<subKey>`** — Supabase `AuthApiError.code` → UI copy
   - **`auth.callback.errors.<code>`** — codes redirected by `app/auth/callback/route.ts`
   - **`<feature>.errors.<DOMAIN_CODE>`** — feature-specific domain codes (e.g. `organizations.create.errors.INVALID_NAME_TOO_SHORT`)
3. If the new code is pan-app (belongs in `common.errors`), also add it to `KNOWN_CODES` in `apps/web/src/providers/query-provider.tsx` — otherwise the global toast falls back to `generic`.
4. If it's a Supabase code, also map it in `CODE_MAP` inside `apps/web/src/features/auth/lib/supabase-auth-error-key.ts`.

### Route-segment error boundaries

`error.tsx` is MANDATORY on every route segment that can throw during render. All three existing segments wrap the same shared `ErrorFallback`:

```tsx
// apps/web/src/app/[locale]/<segment>/error.tsx
'use client';
import { ErrorFallback } from '@/components/common/error-fallback';

export default function SegmentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return <ErrorFallback {...props} />;
}
```

- **Never fork `ErrorFallback`.** If you need different copy, extend the `errorBoundary.*` i18n namespace and accept a `variant` prop on the fallback.
- A server-rendered throw (e.g. our onboarding probe's re-thrown API error) hits this boundary — the localized fallback + retry button renders instead of Next's default blank page.
- `ErrorFallback` surfaces a **support id** (Destek kimliği) when the thrown error is an `ApiError` with `requestId` (from the backend's `X-Request-Id` → `meta.requestId` pipeline) or when Next attaches a `digest` to the error. Users can click to copy — quote this id in support tickets to find the matching server log line.
- Localized 404 is at `apps/web/src/app/[locale]/not-found.tsx` — keep copy under `notFound.*`.

### Forms + `VALIDATION_ERROR` propagation

Mutations that POST validated payloads MUST surface backend field errors inline. The hook suppresses the toast on `VALIDATION_ERROR`; the form walks `error.problem.errors[]` and feeds each issue into `react-hook-form`'s `form.setError`:

```tsx
useEffect(() => {
  const error = createMutation.error;
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') return;
  for (const issue of error.problem.errors ?? []) {
    form.setError(issue.field, { type: 'server', message: issue.code });
  }
}, [createMutation.error, form]);
```

The form's existing `tErr(knownCodeFor(fieldState.error?.message))` path then lights up the inline Turkish message — same i18n key used by client-side zod. See `create-organization-form.tsx` for the canonical example.

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

### SSR safety — hydration-proof components

The root `<html>` already carries `suppressHydrationWarning` because `next-themes` mutates `class` in a head script before React hydrates. That waiver is **only** for the `<html>` attribute — everywhere else, server and client must render byte-identical markup. Four failure modes we have already shipped and reverted:

1. **Reading `theme` during render** (the "Sun vs. Moon" mismatch). `useTheme()` returns `undefined` on the server, the stored preference on the client. Selecting an icon by `theme === 'dark' ? Moon : Sun` bakes the wrong icon into SSR, the client re-renders the other, hydration fails.

   **Fix — CSS-only toggle** (the shadcn pattern): render BOTH icons always; let the `dark:` variant hide/show one. `next-themes`' head script puts `class="dark"` on `<html>` before hydration, so CSS applies from the first paint.

   ```tsx
   // ❌ Bad — reads theme to decide what to render
   <Button>{theme === 'dark' ? <Moon /> : <Sun />}</Button>

   // ✅ Good — CSS swaps both, no JS branch
   <Button>
     <Sun className="scale-100 dark:scale-0 dark:-rotate-90 transition-transform" />
     <Moon className="absolute scale-0 dark:scale-100 dark:rotate-0 transition-transform" />
   </Button>
   ```

   When CSS can't cover it (e.g. Sonner takes `theme` as a prop), guard with `useIsMounted()` / `<ClientOnly>` (both in the shared toolkit) and return `null` or a skeleton during SSR.

2. **Calling `new Date()` / `Date.now()` in the render path** (including for relative time, "now" references, and mock data at module scope in `'use client'` files). Server and client evaluate at different moments; minute- or second-precision labels diverge.

   **Fix — mount gate plus stable fallback:** compute time-dependent labels only after mount.

   ```tsx
   const mounted = useIsMounted();
   const label = mounted
     ? formatter.relativeTime(lastSyncedAt, new Date())
     : formatter.dateTime(lastSyncedAt, 'short'); // deterministic given the prop
   ```

   For showcase **mock** dates, hard-code ISO strings (`new Date('2026-04-20T21:00:00Z')`) — NEVER `new Date(Date.now() - N)` at module scope in a client component. The mocks will age; that is acceptable for demos.

3. **Nested `<button>` in `<button>`** (invalid HTML — browsers silently re-parent, hydration fails). The canonical trap is putting an interactive addon inside a Radix primitive that itself renders as `<button>` (`SelectTrigger`, `DropdownMenuTrigger`, `PopoverTrigger`).

   **Fix — `<span role="button" tabIndex={0}>`** with `onKeyDown` for Enter/Space. Stays keyboard-accessible and announces as a button, but satisfies the HTML nesting rules.

4. **Missing format preset in next-intl.** `formatter.dateTime(date, 'short')` silently falls back to a toString-ish output when `'short'` is not registered in the `formats` config, and that output includes locale-dependent suffixes (`Türkiye Standart Saati` vs. `GMT+03:00`) that differ across platforms.

   **Fix — all presets live in `src/i18n/formats.ts`.** Consume by name (`'short'`, `'long'`, `'date'`, `'currency'`, `'percentDelta'`, …), never by inline options. Add a new preset here before using it.

**The SSR-safety toolkit (shared):**

| Utility          | Location                          | Use for                                                                     |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `useIsMounted()` | `@/lib/use-is-mounted`            | Gate a prop or className conditionally                                      |
| `<ClientOnly>`   | `@/components/common/client-only` | Defer a whole subtree to post-mount; pass a `fallback` for layout stability |
| `FORMATS`        | `@/i18n/formats`                  | Named date / number presets — extend, don't inline                          |

**Review checklist before committing any `'use client'` component that renders temporal or theme-dependent content:**

- [ ] No `Date.now()` / `new Date()` / `Math.random()` at module scope — if the component needs "now", derive it from a client-only hook after mount.
- [ ] No reading `theme`, `resolvedTheme`, `localStorage`, `window.matchMedia` during render without a mount gate or CSS-only alternative.
- [ ] No interactive elements (`<button>`, `<a>`) nested inside another interactive element — Radix triggers ARE buttons; use `role="button"` spans for addon actions.
- [ ] Date / number strings come from `useFormatter()` with a named preset from `formats.ts`, never hand-rolled `Intl.DateTimeFormat`.

### Design system showcase

The live reference for every token, primitive, and pattern lives under `/design/*`:

- `/design/tokens` — colors, typography, spacing, radius, shadow, motion (live swatches)
- `/design/primitives/*` — every shadcn primitive with variants and states
- `/design/patterns` — PazarSync-specific composites (KpiTile, TrendDelta, Currency, SyncBadge, PageHeader, EmptyState)
- `/design/data` — DataTable with filters, sorting, selection, import/export
- `/design/layout-demo` — three-column AppShell with mock store data

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

## UI Development Workflow

All UI work in `apps/web` follows a strict selection cascade. Bypassing it fragments the surface into duplicate/near-duplicate components and dilutes the design system.

### The cascade (mandatory order)

1. **Scan `apps/web/src/components/patterns/`** — PazarSync composites (KpiTile, StatGroup, Currency, TrendDelta, SyncBadge, PageHeader, EmptyState, DateRangePicker, DataTable, DataTableToolbar). Always reuse first.
2. **Scan `apps/web/src/components/ui/`** — 41 shadcn/ui primitives already installed (Button, Card, Dialog, Form, Input, Select, Table, Tabs, Popover, Sheet, …).
3. **Fallback to the shadcn registry** — if `ui/` is genuinely missing a primitive, add it with `pnpm dlx shadcn@latest add <name>`. Don't hand-roll a primitive shadcn already ships.
4. **Custom component** — only if 1–3 all miss. Custom components MUST compose from `ui/` and `patterns/` — never raw HTML, never by forking a primitive.
   - Feature-scoped → `apps/web/src/features/<feature>/components/`
   - Cross-feature composite → promote to `apps/web/src/components/patterns/`

Forking a `ui/` primitive to "tweak styles" is forbidden. Extend tokens or add a `patterns/` wrapper.

### Dashboard aesthetic is locked in tokens

The design system is tuned for a data-dense financial dashboard (Linear / Stripe / Ramp / Mercury tier). Its aesthetic lives in `src/app/tokens/*.css` — OKLCH palette tinted toward hue 265, Host Grotesk, the `--space-*` 4pt scale, and dual-mode shadows with inset highlights. Never introduce a second aesthetic under pressure:

- No new palettes or one-off colors — extend tokens
- No arbitrary values (`bg-[#…]`, `p-[13px]`) — ESLint already blocks these
- Marketing / auth / onboarding use the same system — no separate aesthetic for "landing pages"

If a genuinely new visual direction is needed, extend the design system via `/ui-design-system` — don't bypass it.

### Mandatory skill integration

| Skill               | When to invoke                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/ui-ux-pro-max`    | **Any** UI development or design task — new page, new flow, new component, UI review. Invoke at the start of the task.     |
| `/ui-design-system` | When extending the system — new tokens, new primitives, new patterns, dark-mode adjustments. Additive to `/ui-ux-pro-max`. |

### Before building a new screen

Open the live showcase in the dev server:

- `/design/tokens` — colors, typography, spacing, radius, shadow, motion
- `/design/primitives/*` — every shadcn primitive with variants and states
- `/design/patterns` — PazarSync composites
- `/design/data` — DataTable with filters, sorting, selection
- `/design/layout-demo` — three-column AppShell with mock store data

Anything you need may already be there. The "Component Architecture" section below has full folder semantics.

## Component Architecture

Top-level `src/components/` folders — each has a single, narrow purpose. Don't create new top-level folders without updating this table:

| Folder      | Purpose                                                                            |
| ----------- | ---------------------------------------------------------------------------------- |
| `ui/`       | Raw shadcn/ui primitives. Never fork; extend tokens or add a `patterns/` wrapper.  |
| `patterns/` | PazarSync composites built on `ui/` (currency cells, kpi tiles, data-table shell). |
| `layout/`   | App shell, rails, navigation config — structural chrome only.                      |
| `brand/`    | Logo, wordmark, brand-specific marks.                                              |
| `common/`   | Cross-feature UI utilities not tied to a single feature (e.g. language-switcher).  |
| `showcase/` | Design system demo components, only rendered under `(showcase)` routes.            |

Feature-specific components live under `src/features/<feature>/components/`, not here. Each feature follows this structure:

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
└── types.ts             # Feature-specific types (if not in @pazarsync/api-client)
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
