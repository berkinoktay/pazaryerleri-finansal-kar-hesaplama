# Frontend Auth Integration Implementation Plan

> **For Claude:** Implement this plan task-by-task. Each task ends with a commit; do not skip the commit step. Load `superpowers:executing-plans` before starting.

**Goal:** Enable end-to-end sign-in from the Next.js frontend. A seed user (`berkinoktayai@gmail.com` / `pazarsync-dev-password`) signs in through a form, gets redirected to the dashboard, and sees their real organizations — data that travels from Supabase Auth → browser cookies → Hono backend (via Bearer token) → Prisma → screen. This is the proof that everything we built (auth middleware, RLS, seed) actually hangs together.

**Architecture:**

```
[user types email+password]
          ↓
[signInWithPassword — browser Supabase client]
          ↓ cookies set by @supabase/ssr
[router pushes to /dashboard]
          ↓
[proxy.ts — if no session, redirect to /login]
          ↓
[dashboard renders, React Query hook calls apiClient.GET('/v1/organizations')]
          ↓ openapi-fetch middleware reads session from browser client, sets Authorization: Bearer
[Hono backend — authMiddleware calls supabase.auth.getUser(token)]
          ↓ userId set on context
[organization.service.listForUser(userId) — Prisma SELECT]
          ↓ JSON response
[React Query caches, component renders org list]
```

**Tech Stack:**

- **`@supabase/ssr`** (NEW dep) — Next.js App Router-aware Supabase client that stores session in cookies. Works across Server Components, Server Actions, Route Handlers, and Client Components via different factory functions.
- **`@supabase/supabase-js`** (existing) — still used for browser client factories inside `@supabase/ssr`.
- **Existing**: `@tanstack/react-query` v5, `next-intl`, `react-hook-form` + `zod`, shadcn/ui primitives, `@pazarsync/api-client` (openapi-fetch typed client). All wired and ready.

**Scope — MVP only:**

We intentionally ship the thinnest path that proves the chain. Deferred:

- Sign-up flow (seed users exist; proving sign-in is the goal)
- Email confirmation flow, password reset, OAuth providers
- Profile management UI
- Multi-factor auth
- Sign-out animation / session-expired gentle UX

These go in follow-up PRs. This PR lands: sign-in, sign-out, redirect behaviour, and one real data fetch on the dashboard.

**Pre-flight:**

- [x] PR #27 (RLS foundations) merged.
- [ ] New branch `feat/frontend-auth-integration` off main.
- [ ] Supabase local running, seed applied (`pnpm db:seed` → 11 policies confirmed).
- [ ] `.env` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL=http://localhost:3001`.

**Design decisions — read before starting:**

1. **Why `@supabase/ssr` (cookie-based) instead of plain supabase-js (localStorage)?**
   Session tokens in HTTP-only cookies are inaccessible to XSS-injected JS. localStorage is reachable from any script in the page. For a SaaS that stores competitive cost intelligence, cookies are non-negotiable. Supabase's SSR helper handles the cookie dance correctly across Server/Client boundaries — we do not roll our own.

2. **Why extend `proxy.ts` instead of a layout-level session check?**
   `proxy.ts` runs before the server component tree. A redirect from proxy is instant; a redirect from layout costs one full render. For the login/dashboard gate, proxy wins on ergonomics. next-intl's `createMiddleware` is wrappable — we intercept first, check session, redirect if needed, then delegate to the i18n router.

3. **Why one `apiClient` factory per environment instead of two?**
   Currently `src/lib/api-client.ts` exports a singleton with no token logic. The new shape: a factory `createApiClient(getToken)` where `getToken` returns a promise. Called once per environment (browser vs server) with an appropriate session source. Client components use a browser-token factory; Server Components/Actions use a server-token factory. Same openapi-fetch instance shape both places.

4. **Why `signInWithPassword` in a Client Component form instead of a Server Action?**
   Server Actions would keep the password out of JS entirely, but the Supabase SSR helper handles the cookie side-effect seamlessly from the browser too (it writes cookies via `document.cookie` + sync back through the middleware). Browser-submitted form is simpler and matches the ElectricCodeGuy SSR reference repo. We can switch to Server Action later without breaking anything else; swap a single hook call.

5. **Why skip sign-up in this PR?**
   Goal is end-to-end verification, not feature-complete auth. Seed users are enough. A sign-up flow requires email-confirmation UX (confirmation URL → callback route → redirect) which is extra complexity that distracts from the proof-of-chain. Land the chain first, iterate in a follow-up PR.

---

## Task 1: Install `@supabase/ssr` + create client factories

**Why:** The SSR helper is the Next.js-aware bridge that reads/writes Supabase cookies in the right way across Server Components, Server Actions, Route Handlers, and Client Components. Without it, session state silently diverges between server and browser renders — the classic "works on refresh but not initial load" bug.

**Files:**

- Modify: `apps/web/package.json` — add `@supabase/ssr`
- Create: `apps/web/src/lib/supabase/client.ts` — browser client (used in Client Components)
- Create: `apps/web/src/lib/supabase/server.ts` — server client (used in Server Components, Server Actions, Route Handlers)

**Step 1: Install**

```bash
pnpm --filter @pazarsync/web add @supabase/ssr
```

**Step 2: Browser client**

```typescript
// apps/web/src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']!,
  );
}
```

Called from Client Components to get a fresh client with session. Reusing across components is fine — the instance is light; the session cookie is the source of truth.

**Step 3: Server client**

```typescript
// apps/web/src/lib/supabase/server.ts
import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render — Next.js forbids
            // cookie writes. Harmless if the middleware is also syncing.
          }
        },
      },
    },
  );
}
```

**Step 4: Typecheck + commit**

```bash
pnpm --filter @pazarsync/web typecheck
git add apps/web/package.json apps/web/src/lib/supabase/ pnpm-lock.yaml
git commit -m "chore(web): add @supabase/ssr; browser + server client factories"
```

**Done when:** Both factories compile; no runtime use yet.

---

## Task 2: Extend `proxy.ts` to refresh session + redirect unauthenticated users

**Why:** The proxy is the one place where every request lands before the React tree renders. Refreshing the session cookie here means the rest of the app can trust that `supabase.auth.getSession()` returns a current session. Redirecting from the proxy (vs a layout) avoids a flash-of-login-page on protected routes.

**Files:**

- Modify: `apps/web/src/proxy.ts`
- Create: `apps/web/src/lib/supabase/middleware.ts` — helper factory for the middleware variant

**Step 1: Middleware Supabase client**

```typescript
// apps/web/src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be the FIRST call — forces Supabase to refresh the session
  // and cycle cookies before we inspect auth state.
  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
```

**Step 2: Wrap next-intl middleware**

```typescript
// apps/web/src/proxy.ts
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { updateSession } from './lib/supabase/middleware';

const intl = createIntlMiddleware(routing);

// Routes that DO require an authenticated session.
const PROTECTED = ['/dashboard', '/onboarding'];
// Routes where an authenticated user should be bounced away (back to dashboard).
const AUTH_ONLY_FOR_GUESTS = ['/login', '/register'];

function stripLocale(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && routing.locales.includes(segments[0] as 'tr')) {
    return '/' + segments.slice(1).join('/');
  }
  return pathname;
}

export default async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const path = stripLocale(request.nextUrl.pathname);
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(p + '/'));
  const isGuestOnly = AUTH_ONLY_FOR_GUESTS.some((p) => path === p || path.startsWith(p + '/'));

  if (isProtected && user === null) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isGuestOnly && user !== null) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Pass through to next-intl for locale routing. It returns its own
  // response; merge our refreshed cookies into it.
  const intlResponse = intl(request);
  for (const cookie of response.cookies.getAll()) {
    intlResponse.cookies.set(cookie);
  }
  return intlResponse;
}

export const config = {
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
```

**Step 3: Smoke test**

```bash
pnpm dev --filter web
# Visit /tr/dashboard → redirects to /tr/login?redirect=%2Ftr%2Fdashboard ✓
# Visit /tr/login (no session) → renders login page ✓
# No infinite loops, no 500s.
```

**Step 4: Commit**

```bash
git add apps/web/src/proxy.ts apps/web/src/lib/supabase/middleware.ts
git commit -m "feat(web): session-aware proxy — redirect unauth from protected routes"
```

**Done when:** Manual smoke test passes. Protected route redirects, guest-only route redirects in reverse, public routes untouched.

---

## Task 3: openapi-fetch Bearer-token middleware

**Why:** The typed `apiClient` must attach the current user's JWT to every request. Server and browser need different token sources — factor the client into a factory that takes a `getToken` function.

**Files:**

- Modify: `apps/web/src/lib/api-client.ts` — becomes a factory
- Create: `apps/web/src/lib/api-client/browser.ts` — pre-configured browser instance
- Create: `apps/web/src/lib/api-client/server.ts` — pre-configured server instance

**Step 1: Refactor api-client.ts into a factory**

```typescript
// apps/web/src/lib/api-client.ts
import { createApiClient, type paths } from '@pazarsync/api-client';
import type { Middleware } from 'openapi-fetch';

export interface ApiClientOptions {
  getAccessToken: () => Promise<string | null>;
}

export function makeApiClient({ getAccessToken }: ApiClientOptions) {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  const client = createApiClient<paths>({ baseUrl });

  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      const token = await getAccessToken();
      if (token !== null) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  };
  client.use(authMiddleware);

  return client;
}
```

**Step 2: Browser instance**

```typescript
// apps/web/src/lib/api-client/browser.ts
'use client';
import { createClient } from '../supabase/client';
import { makeApiClient } from '../api-client';

const supabase = createClient();

export const apiClient = makeApiClient({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
```

**Step 3: Server instance (factory, because cookies are per-request)**

```typescript
// apps/web/src/lib/api-client/server.ts
import { createClient } from '../supabase/server';
import { makeApiClient } from '../api-client';

export async function getServerApiClient() {
  const supabase = await createClient();
  return makeApiClient({
    getAccessToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });
}
```

**Step 4: Find-and-replace existing `apiClient` imports**

Existing imports of `apiClient` from `@/lib/api-client` (if any — audit says there are no raw API call sites yet) switch to `@/lib/api-client/browser`. `pnpm --filter @pazarsync/web typecheck` catches breakage.

**Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client/
git commit -m "feat(web): apiClient factories with Bearer-token middleware"
```

**Done when:** Typecheck clean. No runtime use yet — Task 6 consumes this.

---

## Task 4: Sign-in form on `/login`

**Why:** This is the user-visible entry. Keep it dead-simple: email + password, Submit, redirect on success. Error messages via next-intl. react-hook-form + zod for validation, shadcn/ui primitives for polish.

**Files:**

- Modify: `apps/web/src/app/[locale]/(auth)/login/page.tsx` — replace shell with form
- Create: `apps/web/src/features/auth/components/login-form.tsx` — the Client Component
- Create: `apps/web/src/features/auth/hooks/use-sign-in.ts` — mutation hook
- Modify: `apps/web/messages/tr.json` + `en.json` — new strings under `auth.login.*`

**Step 1: The mutation hook**

```typescript
// apps/web/src/features/auth/hooks/use-sign-in.ts
'use client';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

interface SignInInput {
  email: string;
  password: string;
  redirect?: string;
}

export function useSignIn() {
  const router = useRouter();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({ email, password }: SignInInput) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error !== null) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      router.push(vars.redirect ?? '/dashboard');
      router.refresh(); // re-run server components so the proxy sees the fresh cookie
    },
  });
}
```

**Step 2: The form component**

Use shadcn Form + Input + Button. react-hook-form + zod schema. Handle error states from the mutation (`signIn.isError`, `signIn.error?.message`) — translate Supabase error codes to i18n keys.

```tsx
// apps/web/src/features/auth/components/login-form.tsx
'use client';
// ... (full implementation — see CLAUDE.md form patterns)
```

Use next-intl for label + button text + error messages.

**Step 3: Wire into login page**

```tsx
// apps/web/src/app/[locale]/(auth)/login/page.tsx
import { LoginForm } from '@/features/auth/components/login-form';

export default function LoginPage() {
  return <LoginForm />;
}
```

**Step 4: Add i18n keys**

```json
// messages/tr.json
{
  "auth": {
    "login": {
      "title": "Giriş yap",
      "subtitle": "PazarSync hesabınıza giriş yapın",
      "email": "E-posta",
      "password": "Parola",
      "submit": "Giriş yap",
      "errors": {
        "invalidCredentials": "E-posta veya parola hatalı",
        "generic": "Giriş yapılamadı. Lütfen tekrar deneyin."
      }
    }
  }
}
```

Mirror in `en.json`.

**Step 5: Smoke test**

```bash
pnpm dev --filter web
# Navigate to /tr/login
# Enter berkinoktayai@gmail.com + pazarsync-dev-password
# Submit → redirect to /tr/dashboard
# Verify cookie set in devtools (sb-…-auth-token)
```

**Step 6: Commit**

```bash
git add apps/web/src/app/[locale]/\(auth\)/login/page.tsx apps/web/src/features/auth/ apps/web/messages/
git commit -m "feat(web): sign-in form — email/password via Supabase Auth"
```

**Done when:** A seed user can sign in and land on the dashboard.

---

## Task 5: Sign-out button + dashboard header wiring

**Why:** Users need a way out. Add a sign-out handler that clears the session cookie and redirects home. One small component — but it's the other half of the flow we're proving.

**Files:**

- Create: `apps/web/src/features/auth/hooks/use-sign-out.ts`
- Create: `apps/web/src/features/auth/components/user-menu.tsx` — dropdown in app shell
- Modify: wherever AppShell renders the top bar (look for it in dashboard layout)

**Step 1: The hook**

```typescript
// apps/web/src/features/auth/hooks/use-sign-out.ts
'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error !== null) throw error;
    },
    onSuccess: () => {
      qc.clear(); // drop any server data cached under the previous identity
      router.push('/login');
      router.refresh();
    },
  });
}
```

**Step 2: User menu component**

Use shadcn DropdownMenu. Show user email (from session) + "Sign out" item.

```tsx
'use client';
// Display session.user.email + DropdownMenuItem calling signOut.mutate()
```

**Step 3: Mount in AppShell**

Find the dashboard app shell header (per audit, `src/app/[locale]/(dashboard)/layout.tsx`). Place `<UserMenu />` in the top-right.

**Step 4: Commit**

```bash
git add apps/web/src/features/auth/
git commit -m "feat(web): sign-out hook + user menu dropdown in app shell"
```

**Done when:** After sign-out, a protected route redirects to /login (proxy does this automatically because the cookie is gone).

---

## Task 6: Replace dashboard mock data with real `/v1/organizations` call

**Why:** This is the payoff. The dashboard currently shows `MOCK_STORES` and `MOCK_ACTIVITY` (per audit). Swap in a real React Query hook that hits the backend. If this renders the right orgs for the signed-in user, the whole chain works.

**Files:**

- Create: `apps/web/src/features/organizations/api/organizations.api.ts`
- Create: `apps/web/src/features/organizations/hooks/use-organizations.ts`
- Modify: `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx` (or wherever MOCK_STORES lives)

**Step 1: API wrapper**

```typescript
// apps/web/src/features/organizations/api/organizations.api.ts
import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await apiClient.GET('/v1/organizations', {});
  if (error !== undefined) {
    throw new Error(`Failed to fetch organizations: ${JSON.stringify(error)}`);
  }
  return data.data;
}
```

**Step 2: React Query hook**

```typescript
// apps/web/src/features/organizations/hooks/use-organizations.ts
'use client';
import { useQuery } from '@tanstack/react-query';

import { listOrganizations } from '../api/organizations.api';

export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  list: () => [...organizationKeys.lists()] as const,
};

export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.list(),
    queryFn: listOrganizations,
  });
}
```

**Step 3: Replace mock usage**

Find `MOCK_STORES` in dashboard page. Replace with `const { data: organizations, isLoading, error } = useOrganizations()`. Render loading skeleton + error state.

**Step 4: Manual smoke test — THE E2E proof**

```bash
# Terminal 1:
pnpm dev --filter api     # start backend

# Terminal 2:
pnpm dev --filter web     # start frontend

# Browser:
# 1. Visit http://localhost:3000/tr/login
# 2. Sign in: berkinoktayai@gmail.com / pazarsync-dev-password
# 3. Land on /tr/dashboard
# 4. See "Akyıldız Ticaret" and "Yıldırım Ev Ürünleri" listed — NOT mock data
# 5. Open devtools → Network tab
#    Confirm: request to http://localhost:3001/v1/organizations
#    Header: Authorization: Bearer eyJhbGciOiJFUzI1NiI…
#    Response: real seed data
# 6. Click user menu → Sign out → redirected to /login
# 7. Try to visit /tr/dashboard directly → redirected back to /login
```

If ALL seven steps pass, the system works end-to-end. If any fails, the failure point is the defect.

**Step 5: Commit**

```bash
git add apps/web/src/features/organizations/ apps/web/src/app/\[locale\]/\(dashboard\)/
git commit -m "feat(web): dashboard fetches real /v1/organizations via authenticated apiClient"
```

**Done when:** The smoke test passes end-to-end. Dashboard shows real orgs, correctly filtered per user (berkin sees both, demo sees both with different role mix).

---

## Task 7: Docs + memory

**Why:** Capture the patterns so the next developer/AI session doesn't re-derive them.

**Files:**

- Modify: `apps/web/CLAUDE.md` — add "Auth patterns" section (browser client vs server client vs middleware; apiClient token injection pattern)
- Modify: `docs/api-changelog.md` — Unreleased entry noting first live consumer of the API (no backend change, but worth noting frontend integration)
- Modify: `docs/SECURITY.md` — add a short "Frontend session handling" subsection under API Security pointing at cookie-based session, HTTP-only, refresh flow

**Memory update** — not a feedback rule, but a pattern worth noting: "Next.js App Router + Supabase Auth needs three Supabase client flavors (browser / server / middleware), each created via a matching `@supabase/ssr` helper. Mixing them up causes silent session desync."

**Step: Commit**

```bash
git add apps/web/CLAUDE.md docs/api-changelog.md docs/SECURITY.md
git commit -m "docs: frontend auth integration — patterns + security notes"
```

---

## Verification

After all tasks:

```bash
pnpm check:full              # typecheck + lint + all tests + format
pnpm --filter @pazarsync/api dev  # terminal 1
pnpm dev --filter web             # terminal 2
# Browser: run the seven-step smoke test above
```

## Out of scope (tracked for follow-up)

- **Sign-up flow** — separate PR. Includes email-confirm callback route, verification UX.
- **Password reset** — separate PR.
- **OAuth providers** (Google, GitHub) — separate PR. Requires callback route + Supabase dashboard config.
- **Profile management UI** — users want to update full name, avatar, email. Separate feature.
- **Session-expired toast** — gentler UX when backend returns 401 (React Query mutation `onError` → detect 401 → sign out → redirect).
- **Replacing the entire dashboard mock layer** — we only swap `MOCK_STORES` this round. Other mocks stay until their features ship.
- **Next.js Server Actions for auth** — current plan uses browser `signInWithPassword`. Server Actions are a cleaner pattern but add complexity; migrate when we add stricter password policies.

## Estimated size

7 tasks, ~8-10 commits (some tasks produce multiple small commits), ~400-500 LOC net. Biggest single file: proxy.ts (~60 LOC). The rest are small focused modules.
