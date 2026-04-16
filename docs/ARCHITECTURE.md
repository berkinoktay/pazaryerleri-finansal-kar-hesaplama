# ARCHITECTURE.md — PazarSync

## Table of Contents

1. [System Overview](#system-overview)
2. [Multi-Tenancy Architecture](#multi-tenancy-architecture)
3. [Monorepo Structure](#monorepo-structure)
4. [Database Schema](#database-schema)
5. [API Design](#api-design)
6. [Authentication & Authorization](#authentication--authorization)
7. [Marketplace Integration](#marketplace-integration)
8. [Background Sync Architecture](#background-sync-architecture)
9. [Frontend Architecture](#frontend-architecture)
10. [Data Flow Diagrams](#data-flow-diagrams)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Next.js 16 (App Router + Turbopack)                           │  │
│  │  React 19.2 + TanStack React Query + shadcn/ui                │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │ REST (JSON)                          │
├──────────────────────────────┼──────────────────────────────────────┤
│                        API LAYER                                    │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │  Hono (Node.js)                                               │  │
│  │  Auth Middleware → Org Context → Zod Validation → Handlers    │  │
│  │  Services: Profitability, Reconciliation, Expenses            │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │ Prisma ORM                           │
├──────────────────────────────┼──────────────────────────────────────┤
│                        DATA LAYER                                   │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │  Supabase (PostgreSQL 15)                                     │  │
│  │  RLS Policies │ pg_cron │ Supabase Auth                       │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │ pg_cron triggers                     │
├──────────────────────────────┼──────────────────────────────────────┤
│                     BACKGROUND LAYER                                │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │  Supabase Edge Functions (Deno)                               │  │
│  │  sync-trendyol │ sync-hepsiburada │ sync-settlements          │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │ HTTP API calls                       │
├──────────────────────────────┼──────────────────────────────────────┤
│                     EXTERNAL SERVICES                               │
│  ┌────────────────┐  ┌──────┴───────────┐  ┌────────────────────┐  │
│  │  Trendyol API  │  │ Hepsiburada API  │  │  Future marketpl.  │  │
│  └────────────────┘  └──────────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Tenancy Architecture

### Tenant Hierarchy

```
User (Supabase Auth)
│
├── Organization A (tenant)
│   ├── Members: [user1(owner), user2(admin), user3(viewer)]
│   ├── Store: Trendyol - "MainStore"
│   │   ├── Products (synced from Trendyol)
│   │   ├── Orders (synced from Trendyol)
│   │   └── Settlements (synced from Trendyol)
│   ├── Store: Hepsiburada - "HB Store"
│   │   ├── Products (synced from HB)
│   │   ├── Orders (synced from HB)
│   │   └── Settlements (synced from HB)
│   └── Expenses (org-wide or store-scoped)
│
└── Organization B (tenant)
    ├── Members: [user1(owner)]  ← same user, different org
    └── Store: Trendyol - "SideProject"
```

### Data Isolation Strategy

**Layer 1 — Application (Hono Middleware):**
Every request passes through `orgContextMiddleware` which:
1. Extracts `orgId` from URL params
2. Verifies current user is a member of that org
3. Injects `organizationId` into request context
4. All service/repository calls use this context-scoped `organizationId`

**Layer 2 — Database (RLS Policies):**
Row-Level Security as defense-in-depth:
```sql
-- Example RLS policy (applied on every tenant table)
CREATE POLICY "org_isolation" ON orders
  USING (organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid()
  ));
```

**Layer 3 — Schema Design:**
Every tenant-scoped table has:
- `organization_id UUID NOT NULL REFERENCES organizations(id)`
- Index on `organization_id`
- Foreign key with `ON DELETE CASCADE`

### Store-Scoped Views

Operational pages (orders, products, profitability) ALWAYS show data for one selected store. The active store is:
- Stored in frontend state (React Context + URL param)
- Required — dashboard cannot render without a store selection
- Default: first connected store

Cross-store overview is available ONLY on:
- Dashboard overview (aggregated revenue/profit cards)
- Reports page (date-range based cross-store comparison)

---

## 3. Monorepo Structure

```
pazaryerleri-finansal-kar-hesaplama-saas/
│
├── apps/
│   ├── web/                          # Next.js 16 Frontend
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── app/                  # App Router pages
│   │   │   │   ├── (auth)/           # Login, register, forgot-password
│   │   │   │   │   ├── login/
│   │   │   │   │   ├── register/
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (dashboard)/      # Protected app shell
│   │   │   │   │   ├── dashboard/    # Main dashboard
│   │   │   │   │   ├── orders/       # Order listing + detail
│   │   │   │   │   ├── products/     # Product listing + cost management
│   │   │   │   │   ├── profitability/# Profitability analysis
│   │   │   │   │   ├── expenses/     # Expense management
│   │   │   │   │   ├── reconciliation/ # Settlement reconciliation
│   │   │   │   │   ├── settings/     # Org settings, team, stores
│   │   │   │   │   └── layout.tsx    # Dashboard layout (sidebar, store selector)
│   │   │   │   ├── (onboarding)/     # First-time setup flow
│   │   │   │   │   ├── create-org/
│   │   │   │   │   └── connect-store/
│   │   │   │   ├── (marketing)/      # Public pages
│   │   │   │   │   ├── page.tsx      # Landing page
│   │   │   │   │   └── pricing/
│   │   │   │   ├── layout.tsx        # Root layout
│   │   │   │   └── not-found.tsx
│   │   │   ├── components/           # Shared UI components
│   │   │   │   ├── ui/              # shadcn/ui components
│   │   │   │   ├── layout/          # Header, Sidebar, StoreSelector
│   │   │   │   └── shared/          # DataTable, Charts, DatePicker
│   │   │   ├── features/            # Feature modules
│   │   │   │   ├── auth/
│   │   │   │   │   ├── components/
│   │   │   │   │   ├── hooks/
│   │   │   │   │   └── api/
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── components/
│   │   │   │   │   ├── hooks/
│   │   │   │   │   └── api/
│   │   │   │   ├── orders/
│   │   │   │   ├── products/
│   │   │   │   ├── profitability/
│   │   │   │   ├── expenses/
│   │   │   │   ├── reconciliation/
│   │   │   │   ├── organization/
│   │   │   │   └── stores/
│   │   │   ├── hooks/               # Global hooks
│   │   │   │   ├── use-org.ts       # Current org context
│   │   │   │   └── use-store.ts     # Current store context
│   │   │   ├── lib/                 # Utilities
│   │   │   │   ├── api-client.ts    # Configured fetch wrapper
│   │   │   │   ├── supabase/        # Supabase client (browser + server)
│   │   │   │   └── query-client.ts  # React Query config
│   │   │   ├── providers/           # React context providers
│   │   │   │   ├── query-provider.tsx
│   │   │   │   ├── org-provider.tsx
│   │   │   │   ├── store-provider.tsx
│   │   │   │   └── auth-provider.tsx
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── proxy.ts                 # Request interception (replaces middleware.ts in Next.js 16)
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── components.json          # shadcn/ui config
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                          # Hono Backend
│       ├── src/
│       │   ├── routes/               # Route definitions
│       │   │   ├── auth.routes.ts
│       │   │   ├── organization.routes.ts
│       │   │   ├── store.routes.ts
│       │   │   ├── order.routes.ts
│       │   │   ├── product.routes.ts
│       │   │   ├── profitability.routes.ts
│       │   │   ├── expense.routes.ts
│       │   │   ├── settlement.routes.ts
│       │   │   ├── reconciliation.routes.ts
│       │   │   ├── sync.routes.ts
│       │   │   └── dashboard.routes.ts
│       │   ├── services/             # Business logic
│       │   │   ├── organization.service.ts
│       │   │   ├── store.service.ts
│       │   │   ├── order.service.ts
│       │   │   ├── product.service.ts
│       │   │   ├── profitability.service.ts
│       │   │   ├── expense.service.ts
│       │   │   ├── settlement.service.ts
│       │   │   ├── reconciliation.service.ts
│       │   │   └── dashboard.service.ts
│       │   ├── marketplace/          # Marketplace API adapters
│       │   │   ├── types.ts          # Common marketplace interface
│       │   │   ├── trendyol/
│       │   │   │   ├── client.ts     # Trendyol API client
│       │   │   │   ├── mapper.ts     # Response → domain model mapping
│       │   │   │   └── types.ts      # Trendyol-specific types
│       │   │   └── hepsiburada/
│       │   │       ├── client.ts
│       │   │       ├── mapper.ts
│       │   │       └── types.ts
│       │   ├── middleware/           # Hono middleware
│       │   │   ├── auth.middleware.ts       # JWT verification
│       │   │   ├── org-context.middleware.ts # Org isolation
│       │   │   ├── rate-limit.middleware.ts
│       │   │   └── error-handler.middleware.ts
│       │   ├── lib/                  # Utilities
│       │   │   ├── encryption.ts     # Credential encryption/decryption
│       │   │   ├── supabase.ts       # Supabase admin client
│       │   │   └── errors.ts         # Custom error classes
│       │   ├── validators/           # Zod schemas for request validation
│       │   │   ├── organization.validator.ts
│       │   │   ├── store.validator.ts
│       │   │   ├── expense.validator.ts
│       │   │   └── common.validator.ts
│       │   └── index.ts              # App entry point
│       ├── Dockerfile
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── db/                           # Database package (Prisma 7)
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── generated/               # Generated Prisma client (gitignored)
│   │   │   └── prisma/
│   │   ├── prisma.config.ts          # Prisma 7 config (datasource URLs)
│   │   ├── src/
│   │   │   └── index.ts             # PrismaClient singleton with adapter-pg
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── types/                        # Shared types
│   │   ├── src/
│   │   │   ├── api.ts               # API request/response contracts
│   │   │   ├── models.ts            # Domain model interfaces
│   │   │   ├── marketplace.ts       # Platform enum, marketplace types
│   │   │   ├── enums.ts             # Shared enums
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── utils/                        # Shared utilities
│       ├── src/
│       │   ├── currency.ts           # TRY formatting, decimal math
│       │   ├── date.ts               # Date range helpers, period calculations
│       │   ├── validation.ts         # Common Zod schemas (pagination, date range)
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
│
├── supabase/
│   ├── functions/                    # Edge Functions
│   │   ├── sync-trendyol/
│   │   │   └── index.ts
│   │   ├── sync-hepsiburada/
│   │   │   └── index.ts
│   │   └── _shared/                 # Shared code between functions
│   │       ├── supabase-client.ts
│   │       └── sync-utils.ts
│   ├── sql/                          # SQL scripts (not managed by Prisma)
│   │   ├── rls-policies.sql          # Row-Level Security policies
│   │   ├── pg-cron-setup.sql         # Cron job definitions
│   │   └── db-functions.sql          # PostgreSQL functions
│   └── config.toml
│
├── turbo.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── .gitignore
├── CLAUDE.md
└── ARCHITECTURE.md
```

---

## 4. Database Schema

### Entity Relationship Diagram

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│   auth.users     │     │   user_profiles       │     │  organizations   │
│ (Supabase Auth)  │     │                       │     │                  │
│──────────────────│     │──────────────────────│     │──────────────────│
│ id (uuid) PK     │────▶│ id (uuid) PK/FK      │     │ id (uuid) PK     │
│ email            │     │ email                 │     │ name             │
│ ...              │     │ full_name             │     │ slug (unique)    │
└──────────────────┘     │ avatar_url            │     │ created_at       │
                         │ created_at            │     │ updated_at       │
                         │ updated_at            │     └────────┬─────────┘
                         └──────────┬────────────┘              │
                                    │                           │
                         ┌──────────┴───────────────────────────┴─────────┐
                         │            organization_members                 │
                         │─────────────────────────────────────────────────│
                         │ id (uuid) PK                                    │
                         │ organization_id (uuid) FK → organizations       │
                         │ user_id (uuid) FK → user_profiles               │
                         │ role (enum: OWNER|ADMIN|MEMBER|VIEWER)          │
                         │ created_at                                       │
                         │ UNIQUE(organization_id, user_id)                │
                         └─────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                              stores                                      │
│──────────────────────────────────────────────────────────────────────────│
│ id (uuid) PK                                                             │
│ organization_id (uuid) FK → organizations                                │
│ name (varchar)                                                           │
│ platform (enum: TRENDYOL|HEPSIBURADA)                                   │
│ credentials (jsonb) — encrypted {api_key, api_secret, seller_id}        │
│ is_active (boolean)                                                      │
│ last_sync_at (timestamptz)                                               │
│ created_at, updated_at                                                   │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┬───────────────────┐
          ▼                    ▼                    ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐
│    products      │  │     orders       │  │  settlements   │  │  sync_logs   │
│─────────────────│  │─────────────────│  │────────────────│  │──────────────│
│ id PK            │  │ id PK            │  │ id PK          │  │ id PK        │
│ organization_id  │  │ organization_id  │  │ organization_id│  │ store_id FK  │
│ store_id FK      │  │ store_id FK      │  │ store_id FK    │  │ sync_type    │
│ platform_product │  │ platform_order_id│  │ platform_set_id│  │ status       │
│ _id (unique w/   │  │ (unique w/store) │  │ period_start   │  │ started_at   │
│  store)          │  │ order_date       │  │ period_end     │  │ completed_at │
│ barcode          │  │ status           │  │ gross_amount   │  │ records_     │
│ title            │  │ total_amount     │  │ net_amount     │  │  processed   │
│ category         │  │ commission_amount│  │ status         │  │ error_message│
│ cost_price       │  │ shipping_cost    │  │ created_at     │  └──────────────┘
│ created_at       │  │ platform_fee     │  │ updated_at     │
│ updated_at       │  │ vat_amount       │  └───────┬────────┘
└────────┬────────┘  │ net_profit       │          │
         │           │ created_at       │  ┌───────┴────────┐
         │           │ updated_at       │  │settlement_items│
         │           └───────┬──────────┘  │────────────────│
         │                   │             │ id PK          │
         │           ┌───────┴──────────┐  │ settlement_id  │
         │           │   order_items     │  │ order_id       │
         │           │──────────────────│  │ amount         │
         └──────────▶│ id PK            │  │ type (enum)    │
                     │ order_id FK      │  └────────────────┘
                     │ product_id FK    │
                     │ quantity         │
                     │ unit_price       │
                     │ commission_rate  │
                     │ commission_amount│
                     └──────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                         expenses                              │
│──────────────────────────────────────────────────────────────│
│ id (uuid) PK                                                  │
│ organization_id (uuid) FK → organizations                     │
│ store_id (uuid, nullable) FK → stores — null = org-wide       │
│ category (enum: PRODUCT_COST|ADVERTISING|PACKAGING|...)       │
│ description (text)                                            │
│ amount (decimal 12,2)                                         │
│ date (date)                                                   │
│ is_recurring (boolean)                                        │
│ created_at, updated_at                                        │
└──────────────────────────────────────────────────────────────┘
```

### Prisma Schema (Summary)

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  // url and directUrl configured in prisma.config.ts
}

// ─── Enums ───────────────────────────────────────────

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum Platform {
  TRENDYOL
  HEPSIBURADA
}

enum OrderStatus {
  PENDING
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED
  RETURNED
}

enum SettlementStatus {
  PENDING
  VERIFIED
  DISCREPANCY
}

enum SettlementItemType {
  SALE
  RETURN
  COMMISSION
  SHIPPING
  SERVICE_FEE
  PROMOTION
  OTHER
}

enum ExpenseCategory {
  PRODUCT_COST
  ADVERTISING
  PACKAGING
  SHIPPING_SUPPLY
  SOFTWARE
  PERSONNEL
  RENT
  OTHER
}

enum SyncType {
  ORDERS
  PRODUCTS
  SETTLEMENTS
}

enum SyncStatus {
  RUNNING
  COMPLETED
  FAILED
}

// ─── Models ──────────────────────────────────────────

model UserProfile {
  id        String   @id @db.Uuid              // matches auth.users.id
  email     String   @unique
  fullName  String?  @map("full_name")
  avatarUrl String?  @map("avatar_url")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  memberships OrganizationMember[]

  @@map("user_profiles")
}

model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  slug      String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  members  OrganizationMember[]
  stores   Store[]
  expenses Expense[]

  @@map("organizations")
}

model OrganizationMember {
  id             String     @id @default(uuid()) @db.Uuid
  organizationId String     @map("organization_id") @db.Uuid
  userId         String     @map("user_id") @db.Uuid
  role           MemberRole @default(MEMBER)
  createdAt      DateTime   @default(now()) @map("created_at")
  updatedAt      DateTime   @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         UserProfile  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@map("organization_members")
}

model Store {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  name           String
  platform       Platform
  credentials    Json                                      // encrypted JSON
  isActive       Boolean  @default(true) @map("is_active")
  lastSyncAt     DateTime? @map("last_sync_at")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  products     Product[]
  orders       Order[]
  settlements  Settlement[]
  syncLogs     SyncLog[]

  @@index([organizationId])
  @@map("stores")
}

model Product {
  id                String   @id @default(uuid()) @db.Uuid
  organizationId    String   @map("organization_id") @db.Uuid
  storeId           String   @map("store_id") @db.Uuid
  platformProductId String   @map("platform_product_id")
  barcode           String?
  title             String
  category          String?
  costPrice         Decimal? @map("cost_price") @db.Decimal(12, 2)
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  store      Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)
  orderItems OrderItem[]

  @@unique([storeId, platformProductId])
  @@index([organizationId])
  @@map("products")
}

model Order {
  id               String      @id @default(uuid()) @db.Uuid
  organizationId   String      @map("organization_id") @db.Uuid
  storeId          String      @map("store_id") @db.Uuid
  platformOrderId  String      @map("platform_order_id")
  orderDate        DateTime    @map("order_date")
  status           OrderStatus
  totalAmount      Decimal     @map("total_amount") @db.Decimal(12, 2)
  commissionAmount Decimal     @map("commission_amount") @db.Decimal(12, 2)
  shippingCost     Decimal     @map("shipping_cost") @db.Decimal(12, 2)
  platformFee      Decimal     @default(0) @map("platform_fee") @db.Decimal(12, 2)
  vatAmount        Decimal     @default(0) @map("vat_amount") @db.Decimal(12, 2)
  netProfit        Decimal?    @map("net_profit") @db.Decimal(12, 2)
  createdAt        DateTime    @default(now()) @map("created_at")
  updatedAt        DateTime    @updatedAt @map("updated_at")

  store Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)
  items OrderItem[]

  @@unique([storeId, platformOrderId])
  @@index([organizationId])
  @@index([orderDate])
  @@map("orders")
}

model OrderItem {
  id               String  @id @default(uuid()) @db.Uuid
  orderId          String  @map("order_id") @db.Uuid
  productId        String? @map("product_id") @db.Uuid
  quantity         Int
  unitPrice        Decimal @map("unit_price") @db.Decimal(12, 2)
  commissionRate   Decimal @map("commission_rate") @db.Decimal(5, 2)
  commissionAmount Decimal @map("commission_amount") @db.Decimal(12, 2)

  order   Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product Product? @relation(fields: [productId], references: [id], onDelete: SetNull)

  @@map("order_items")
}

model Settlement {
  id                   String           @id @default(uuid()) @db.Uuid
  organizationId       String           @map("organization_id") @db.Uuid
  storeId              String           @map("store_id") @db.Uuid
  platformSettlementId String?          @map("platform_settlement_id")
  periodStart          DateTime         @map("period_start")
  periodEnd            DateTime         @map("period_end")
  grossAmount          Decimal          @map("gross_amount") @db.Decimal(12, 2)
  netAmount            Decimal          @map("net_amount") @db.Decimal(12, 2)
  status               SettlementStatus @default(PENDING)
  createdAt            DateTime         @default(now()) @map("created_at")
  updatedAt            DateTime         @updatedAt @map("updated_at")

  store Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  items SettlementItem[]

  @@index([organizationId])
  @@map("settlements")
}

model SettlementItem {
  id           String             @id @default(uuid()) @db.Uuid
  settlementId String             @map("settlement_id") @db.Uuid
  orderId      String?            @map("order_id") @db.Uuid
  amount       Decimal            @db.Decimal(12, 2)
  type         SettlementItemType

  settlement Settlement @relation(fields: [settlementId], references: [id], onDelete: Cascade)

  @@map("settlement_items")
}

model Expense {
  id             String          @id @default(uuid()) @db.Uuid
  organizationId String          @map("organization_id") @db.Uuid
  storeId        String?         @map("store_id") @db.Uuid
  category       ExpenseCategory
  description    String?
  amount         Decimal         @db.Decimal(12, 2)
  date           DateTime        @db.Date
  isRecurring    Boolean         @default(false) @map("is_recurring")
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")

  @@index([organizationId])
  @@map("expenses")
}

model SyncLog {
  id               String     @id @default(uuid()) @db.Uuid
  storeId          String     @map("store_id") @db.Uuid
  syncType         SyncType   @map("sync_type")
  status           SyncStatus
  startedAt        DateTime   @map("started_at")
  completedAt      DateTime?  @map("completed_at")
  recordsProcessed Int        @default(0) @map("records_processed")
  errorMessage     String?    @map("error_message")

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId, startedAt])
  @@map("sync_logs")
}
```

### Key Indexes

| Table | Index | Purpose |
|-------|-------|---------|
| `stores` | `organization_id` | Tenant isolation queries |
| `products` | `(store_id, platform_product_id)` UNIQUE | Dedup marketplace products |
| `products` | `organization_id` | Tenant isolation |
| `orders` | `(store_id, platform_order_id)` UNIQUE | Dedup marketplace orders |
| `orders` | `organization_id` | Tenant isolation |
| `orders` | `order_date` | Date range queries for reports |
| `settlements` | `organization_id` | Tenant isolation |
| `expenses` | `organization_id` | Tenant isolation |
| `sync_logs` | `(store_id, started_at)` | Sync history lookups |
| `organization_members` | `(organization_id, user_id)` UNIQUE | Membership lookup |

---

## 5. API Design

### Base URL & Versioning

```
Production:  https://api.pazarsync.com/v1
Development: http://localhost:3001/v1
```

### Authentication Header

```
Authorization: Bearer <supabase_access_token>
```

### URL Convention

All tenant-scoped endpoints are nested under the organization:

```
/v1/organizations/:orgId/...
/v1/organizations/:orgId/stores/:storeId/...
```

### Endpoints

#### Organizations

```
GET    /v1/organizations                    → List user's organizations
POST   /v1/organizations                    → Create organization
GET    /v1/organizations/:orgId             → Get organization details
PATCH  /v1/organizations/:orgId             → Update organization
DELETE /v1/organizations/:orgId             → Delete organization (owner only)
```

#### Organization Members

```
GET    /v1/organizations/:orgId/members                → List members
POST   /v1/organizations/:orgId/members/invite         → Invite member (email + role)
PATCH  /v1/organizations/:orgId/members/:memberId      → Update member role
DELETE /v1/organizations/:orgId/members/:memberId      → Remove member
```

#### Stores

```
GET    /v1/organizations/:orgId/stores                       → List stores
POST   /v1/organizations/:orgId/stores                       → Create store (connect marketplace)
GET    /v1/organizations/:orgId/stores/:storeId               → Get store details
PATCH  /v1/organizations/:orgId/stores/:storeId               → Update store
DELETE /v1/organizations/:orgId/stores/:storeId               → Disconnect store
POST   /v1/organizations/:orgId/stores/:storeId/test          → Test API connection
POST   /v1/organizations/:orgId/stores/:storeId/sync          → Trigger manual sync
```

#### Orders (store-scoped)

```
GET    /v1/organizations/:orgId/stores/:storeId/orders            → List orders (paginated, filterable)
GET    /v1/organizations/:orgId/stores/:storeId/orders/:orderId   → Order detail with items & profit breakdown
```

Query params: `?status=DELIVERED&from=2026-01-01&to=2026-01-31&page=1&limit=50&sort=order_date:desc`

#### Products (store-scoped)

```
GET    /v1/organizations/:orgId/stores/:storeId/products              → List products
GET    /v1/organizations/:orgId/stores/:storeId/products/:productId   → Product detail
PATCH  /v1/organizations/:orgId/stores/:storeId/products/:productId   → Update cost price
POST   /v1/organizations/:orgId/stores/:storeId/products/bulk-cost    → Bulk update cost prices
```

#### Profitability

```
GET    /v1/organizations/:orgId/stores/:storeId/profitability/summary      → Period summary (revenue, costs, profit)
GET    /v1/organizations/:orgId/stores/:storeId/profitability/by-product   → Per-product profitability
GET    /v1/organizations/:orgId/stores/:storeId/profitability/by-order     → Per-order profitability
GET    /v1/organizations/:orgId/profitability/overview                      → Cross-store overview
```

Query params: `?from=2026-01-01&to=2026-01-31`

#### Expenses

```
GET    /v1/organizations/:orgId/expenses                    → List expenses (filterable by store, category, date)
POST   /v1/organizations/:orgId/expenses                    → Create expense
PATCH  /v1/organizations/:orgId/expenses/:expenseId         → Update expense
DELETE /v1/organizations/:orgId/expenses/:expenseId         → Delete expense
```

#### Settlements (store-scoped)

```
GET    /v1/organizations/:orgId/stores/:storeId/settlements               → List settlements
GET    /v1/organizations/:orgId/stores/:storeId/settlements/:settlementId → Settlement detail with items
```

#### Reconciliation (store-scoped)

```
GET    /v1/organizations/:orgId/stores/:storeId/reconciliation        → Get reconciliation status
POST   /v1/organizations/:orgId/stores/:storeId/reconciliation/run    → Run reconciliation for period
```

#### Dashboard

```
GET    /v1/organizations/:orgId/stores/:storeId/dashboard    → Store dashboard data
GET    /v1/organizations/:orgId/dashboard/overview           → Cross-store overview
```

#### Sync Status

```
GET    /v1/organizations/:orgId/stores/:storeId/sync/status  → Current sync status
GET    /v1/organizations/:orgId/stores/:storeId/sync/logs    → Sync history
```

### Common Response Shapes

**Success (single item):**
```json
{
  "data": { ... },
  "meta": { "requestId": "uuid" }
}
```

**Success (list):**
```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 234,
    "totalPages": 5,
    "requestId": "uuid"
  }
}
```

**Error (RFC 7807):**
```json
{
  "type": "https://api.pazarsync.com/errors/validation",
  "title": "Validation Error",
  "status": 422,
  "detail": "cost_price must be a positive number",
  "errors": [
    { "field": "cost_price", "message": "Must be a positive number" }
  ]
}
```

---

## 6. Authentication & Authorization

### Auth Flow

```
1. User signs up/in via Supabase Auth (frontend SDK)
2. Frontend receives JWT access token + refresh token
3. Every API request includes: Authorization: Bearer <token>
4. Hono auth middleware verifies JWT using Supabase JWT secret
5. Middleware extracts user_id from token payload
6. org-context middleware verifies user membership in requested org
7. Route handler receives verified { userId, organizationId, role }
```

### Role Permissions Matrix

| Action | OWNER | ADMIN | MEMBER | VIEWER |
|--------|:-----:|:-----:|:------:|:------:|
| View dashboard & reports | Y | Y | Y | Y |
| View orders & products | Y | Y | Y | Y |
| Manage expenses | Y | Y | Y | N |
| Update product costs | Y | Y | Y | N |
| Run reconciliation | Y | Y | N | N |
| Connect/disconnect stores | Y | Y | N | N |
| Manage team members | Y | Y | N | N |
| Change org settings | Y | Y | N | N |
| Delete organization | Y | N | N | N |
| Manage billing | Y | N | N | N |

---

## 7. Marketplace Integration

### Adapter Pattern

Each marketplace implements a common interface:

```typescript
interface MarketplaceAdapter {
  testConnection(): Promise<boolean>
  fetchOrders(params: SyncParams): Promise<MarketplaceOrder[]>
  fetchProducts(params: SyncParams): Promise<MarketplaceProduct[]>
  fetchSettlements(params: SyncParams): Promise<MarketplaceSettlement[]>
}
```

### Supported Platforms

| Platform | API Type | Auth | Rate Limit |
|----------|----------|------|-----------|
| **Trendyol** | REST | API Key + Secret + Seller ID | 10 req/sec |
| **Hepsiburada** | REST | API Key + Secret + Merchant ID | TBD |

### Credential Storage

```
1. User enters API credentials in store connection form
2. Frontend sends credentials to backend
3. Backend encrypts credentials using AES-256-GCM with ENCRYPTION_KEY
4. Encrypted JSON stored in stores.credentials column
5. Decrypted only when sync functions need to call marketplace API
```

---

## 8. Background Sync Architecture

### Flow

```
pg_cron (every 15 min)
  │
  ├── SELECT active stores with stale last_sync_at
  │
  └── For each store:
        │
        ├── Call Supabase Edge Function via pg_net
        │   POST /functions/v1/sync-trendyol  { storeId, syncType }
        │   POST /functions/v1/sync-hepsiburada { storeId, syncType }
        │
        └── Edge Function:
              1. Read encrypted credentials from DB
              2. Decrypt credentials
              3. Call marketplace API (paginated)
              4. Map response to internal schema
              5. Upsert records (ON CONFLICT DO UPDATE)
              6. Update store.last_sync_at
              7. Write sync_log entry
```

### Sync Types & Frequencies

| Sync Type | Default Frequency | Window |
|-----------|------------------|--------|
| Orders | Every 15 minutes | Last 24 hours |
| Products | Every 6 hours | Full catalog |
| Settlements | Every 24 hours | Last 7 days |

### Error Handling

- Failed syncs are logged in `sync_logs` with error details
- After 3 consecutive failures, store is marked for attention (UI warning)
- Sync never blocks user operations — it's fully asynchronous
- Manual sync trigger available via API

---

## 9. Frontend Architecture

### Page Layout

```
┌─────────────────────────────────────────────────────────┐
│  Header: [Logo]  [Org Selector ▼]  [Store Selector ▼]  │
├────────┬────────────────────────────────────────────────┤
│        │                                                │
│  Side  │            Main Content Area                   │
│  bar   │                                                │
│        │   Renders based on:                            │
│  Nav   │   - Selected route                             │
│  Links │   - Active organization (context)              │
│        │   - Active store (context)                     │
│        │                                                │
│        │                                                │
├────────┴────────────────────────────────────────────────┤
│  Footer (minimal)                                       │
└─────────────────────────────────────────────────────────┘
```

### Feature Module Pattern

Each feature follows this structure:
```
features/orders/
├── components/         # Feature-specific React components
│   ├── OrdersTable.tsx
│   ├── OrderDetail.tsx
│   └── OrderFilters.tsx
├── hooks/             # Feature-specific hooks
│   ├── use-orders.ts  # React Query hooks for orders
│   └── use-order-filters.ts
├── api/               # API call functions
│   └── orders.api.ts  # fetch functions used by hooks
└── types.ts           # Feature-specific types (if not in @pazarsync/types)
```

### State Management

| State Type | Solution |
|-----------|---------|
| Server state (orders, products, etc.) | TanStack React Query |
| Auth state | Supabase Auth + React Context |
| Organization context | React Context (OrgProvider) |
| Store selection | React Context (StoreProvider) + URL search param |
| UI state (modals, filters) | Local React state (useState) |

### Data Fetching Pattern

```
Component → useOrders() hook → ordersApi.list() → fetch(/v1/org/:id/stores/:sid/orders)
                                                        ↓
                                              Hono validates + queries Prisma
                                                        ↓
                                              React Query caches response
```

---

## 10. Data Flow Diagrams

### Order Profitability Calculation

```
Order from Marketplace
│
├── Revenue
│   └── total_amount (what customer paid)
│
├── Deductions (from marketplace)
│   ├── commission_amount (category-based %)
│   ├── shipping_cost (desi-based)
│   ├── platform_fee (weekly service charge, prorated)
│   └── vat_amount
│
├── Costs (user-entered)
│   ├── product cost_price × quantity (from products table)
│   ├── packaging cost (from expenses, prorated)
│   └── advertising cost (from expenses, prorated)
│
└── Net Profit = Revenue - Deductions - Costs
```

### Reconciliation Flow

```
Expected (from orders)              Actual (from settlements)
┌────────────────────┐              ┌────────────────────┐
│ Sum of delivered    │              │ Settlement report   │
│ order net amounts   │              │ from marketplace   │
│ in period          │              │ for same period     │
└────────┬───────────┘              └────────┬───────────┘
         │                                   │
         └──────────┬───────────────────────┘
                    │
              ┌─────┴─────┐
              │ Match?     │
              └─────┬─────┘
              YES   │   NO
              ┌─────┴─────┐
              │ VERIFIED   │  DISCREPANCY (show diff)
              └───────────┘
```

### Context Switching Flow

```
User Login
  │
  ├── GET /v1/organizations → list user's orgs
  │
  ├── User selects org (or auto-selects if only one)
  │   └── OrgProvider sets orgId in context
  │
  ├── GET /v1/organizations/:orgId/stores → list org's stores
  │
  ├── User selects store (or auto-selects first/default)
  │   └── StoreProvider sets storeId in context + URL param
  │
  └── Dashboard loads with:
      GET /v1/organizations/:orgId/stores/:storeId/dashboard
```
