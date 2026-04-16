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

  return <div>{formatCurrency(totalProfit)} ({profitableCount} profitable)</div>;
}

// ✅ Good — derive during render
function OrderSummary({ orders }: { orders: Order[] }) {
  const totalProfit = useMemo(
    () => orders.reduce((sum, o) => sum.add(o.netProfit), new Decimal(0)),
    [orders],
  );
  const profitableCount = useMemo(
    () => orders.filter((o) => o.netProfit.gt(0)).length,
    [orders],
  );

  return <div>{formatCurrency(totalProfit)} ({profitableCount} {t('orders.profitable')})</div>;
}
```

```tsx
// ❌ Bad — prop drilling through 4 levels
function StorePage({ storeId }: { storeId: string }) {
  const { data: store } = useStore(storeId);
  return <StoreLayout store={store}>
    <OrderPanel store={store} />
  </StoreLayout>;
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
import type { components } from "@pazarsync/api-client";
import { apiClient } from "@/lib/api-client";

export type Organization = components["schemas"]["Organization"];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await apiClient.GET("/v1/organizations", {});
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

- Tailwind only, no inline `style={}` except truly dynamic values (e.g., chart dimensions)
- `cn()` for conditional classes, never string concatenation
- Prefer Tailwind scale over arbitrary values (`p-4` not `p-[17px]`)
- Mobile-first responsive design
- Turkish text always through i18n (next-intl), never inline

```tsx
// ❌ Bad — string concatenation, arbitrary values, inline styles
function ProfitBadge({ profit }: { profit: Decimal }) {
  const isPositive = profit.gt(0);
  return (
    <span
      className={"rounded px-2 py-1 text-sm " + (isPositive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}
      style={{ minWidth: '73px', marginLeft: '13px' }}
    >
      {formatCurrency(profit)}
    </span>
  );
}

// ✅ Good — cn(), Tailwind scale, no inline styles
function ProfitBadge({ profit }: { profit: Decimal }) {
  return (
    <span
      className={cn(
        'rounded px-2 py-1 text-sm min-w-[4.5rem] ml-3',
        profit.gt(0)
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-red-50 text-red-700',
      )}
    >
      {formatCurrency(profit)}
    </span>
  );
}
```

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
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
const ProfitChart = dynamic(
  () => import('@/features/profitability/components/profit-chart'),
  { loading: () => <ChartSkeleton /> },
);
```

## No Utility Duplication

Before writing a new utility, check `packages/utils/src/` first. If it's frontend-only (e.g., React hooks, DOM helpers), put it in `apps/web/src/lib/`. If it's shared (currency, date, validation), it goes in `@pazarsync/utils`.
