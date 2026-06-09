# @pazarsync/marketplace

Marketplace adapters (Trendyol, Hepsiburada), the `MarketplaceAdapter` interface,
and the `getAdapter` platform registry. Consumed by both `apps/api` and
`apps/sync-worker` — marketplace HTTP and mapping logic lives here, never inside
an app.

## Adapter contract

Add a marketplace by implementing `MarketplaceAdapter` and registering its
platform in the registry. `getAdapter(store)` picks the implementation;
`decryptStoreCredentials(store)` is the single source of truth for turning a
store's encrypted blob into typed credentials (decrypt + narrow), used by both
the api store service and the sync-worker handlers.

## Vendor endpoints are an architectural constraint

When the vendor docs say "use endpoint Y for workload Z", that is a constraint,
not a suggestion — a periodic backfill sync uses the stream endpoint; a single
lookup uses the page endpoint. Read the relevant file under
`docs/integrations/trendyol/` before touching Trendyol code.

See the root `CLAUDE.md` and `apps/api/CLAUDE.md` ("Marketplace Adapters").
