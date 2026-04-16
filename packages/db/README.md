# @pazarsync/db

Prisma 7 schema, generated client, and migrations for PazarSync.

## What's here

- `prisma/schema.prisma` — single source of truth for the data model (organizations, stores, orders, products, settlements, sync logs, expenses)
- `prisma/migrations/` — versioned SQL migrations
- `prisma/seed.ts` — local dev seed data
- `src/index.ts` — exports `prisma`, the configured `PrismaClient` singleton (with `@prisma/adapter-pg`)
- `generated/prisma/` — generated client output (gitignored, regenerated on `pnpm db:generate`)

## Prisma 7 specifics

This package uses Prisma 7's modern setup:

- Generator: `prisma-client` (not `prisma-client-js`)
- Output dir: `../generated/prisma` (relative to schema)
- Datasource URL: configured in `prisma.config.ts`, **not** in the schema
- Driver adapter: `@prisma/adapter-pg` is required
- ESM: package uses `"type": "module"`

Import the client from the package — never directly from `generated/`:

```typescript
import { prisma } from '@pazarsync/db';
```

Internally, `src/index.ts` does:

```typescript
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
export const prisma = new PrismaClient({ adapter });
```

## Schema conventions

- All tenant tables have an indexed `organization_id` column
- `@@map` is used for snake_case table names
- `created_at` and `updated_at` on every table
- Hard delete with cascading (no soft delete)
- Monetary columns use Postgres `decimal(...)` — paired with `decimal.js` in app code, never floating point
- Marketplace credentials stored as encrypted JSON (encryption at the application layer, never plaintext)

Full schema docs in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Commands

From the repo root (or `pnpm --filter @pazarsync/db <script>`):

```bash
pnpm db:generate            # regenerate the Prisma client (after schema edits)
pnpm db:push                # push schema to dev DB without creating a migration
pnpm db:migrate             # create + apply a new migration (dev)
pnpm db:seed                # run prisma/seed.ts
pnpm db:studio              # open Prisma Studio
```

Integration tests reset the DB with `truncateAll()` from [`apps/api/tests/helpers/db.ts`](../../apps/api/tests/helpers/db.ts).
