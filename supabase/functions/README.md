# Supabase Edge Functions

These are **Deno** functions, deployed to Supabase's edge runtime. They are
deliberately **outside the pnpm/turbo workspace**.

## They cannot import `@pazarsync/*`

The edge runtime is Deno (URL / `jsr:` / `npm:` specifiers, per-function
`deno.json` import map), not the Node + pnpm-workspace resolver the rest of the
monorepo uses. An Edge Function **cannot** `import { ... } from '@pazarsync/...'`.

Consequence: any logic an Edge Function shares _conceptually_ with the workspace
is **re-implemented here, self-contained, and kept minimal**. Today the only
such case is FX parsing — `fx-rates-sync/tcmb-parser.ts` is a pure, dependency-
free parser duplicated on purpose rather than pulled from a package. If that
duplication ever grows, the fix is a published (jsr/npm) shared module, not a
workspace import.

## Functions

| Function        | Purpose                                                                                                                              | Tests |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `fx-rates-sync` | Fetches TCMB `today.xml`, parses USD/EUR **ForexBuying**, upserts `fx_rates`. Daily via pg_cron + pg_net. Feeds money math → tested. | ✅    |

`_shared/` is a placeholder for shared Deno modules (empty today).

## Marketplace sync does NOT live here

`sync-trendyol` and `sync-hepsiburada` used to exist as "Hello from Functions!"
boilerplate stubs and were **removed** — they implied an Edge-Function sync path
that does not exist. Marketplace order/product/settlement sync is owned entirely
by **`apps/sync-worker`** (the long-running, queue-driven worker that claims
`SyncLog` jobs). Do not re-add Edge stubs expecting them to be the sync path.

## CI

`.github/workflows/ci.yml` → the **`edge-functions`** job:

- `deno check` per function directory (each uses its own `deno.json` import map);
- `deno test` for `fx-rates-sync` (the parser feeds `fx_rates`, used in money math).

Nothing else in CI type-checks or tests these files — `pnpm typecheck` / `lint`
only see the Node workspace.

## Local

```bash
deno check supabase/functions/fx-rates-sync/index.ts          # type-check
deno test --allow-read supabase/functions/fx-rates-sync/      # run parser tests
supabase functions serve                                       # run locally
```
