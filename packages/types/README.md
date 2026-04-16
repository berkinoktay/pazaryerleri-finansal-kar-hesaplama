# @pazarsync/types

Shared TypeScript types for PazarSync — used by both the frontend and backend.

## What goes here

- API request and response shape types that are not derived from OpenAPI codegen
- Domain model interfaces shared across apps
- Marketplace enums (platforms, order statuses, settlement event types)
- Discriminated union types for cross-marketplace payloads

## What does NOT go here

- **API contract types generated from the OpenAPI spec** — those live in [`@pazarsync/api-client`](../api-client) under `src/generated/`. The frontend consumes them via `components["schemas"]["..."]`.
- **DB row types** — those come from [`@pazarsync/db`](../db) (Prisma's generated client).
- **Frontend-only or backend-only types** — keep those next to the code that uses them.

## Layout

```
src/
├── api.ts                  Hand-written request/response shapes that aren't in the OpenAPI spec
├── enums.ts                Cross-cutting enums (Platform, OrderStatus, SettlementEventType, …)
├── marketplace.ts          Cross-marketplace domain types (MarketplaceOrder, MarketplaceSettlement, …)
└── index.ts                Barrel — only export at the package boundary
```

## Usage

```typescript
import type { Platform, OrderStatus, MarketplaceOrder } from '@pazarsync/types';
```
