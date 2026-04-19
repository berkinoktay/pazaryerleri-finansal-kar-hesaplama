# SECURITY.md — PazarSync Security Requirements

> **CRITICAL DOCUMENT.** This file defines non-negotiable security rules for the entire platform. Every contributor — and every AI assistant — MUST read this before writing code that touches user data, credentials, or cross-tenant boundaries.

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Data Isolation (Multi-Tenancy)](#2-data-isolation-multi-tenancy)
3. [Store-Level Authorization](#3-store-level-authorization)
4. [Credential Storage & Encryption](#4-credential-storage--encryption)
5. [Sensitive Data Protection](#5-sensitive-data-protection)
6. [API Security](#6-api-security)
7. [Database Security (RLS)](#7-database-security-rls)
8. [Logging & Audit](#8-logging--audit)
9. [Security Review Checklist](#9-security-review-checklist)

---

## 1. Threat Model

PazarSync stores **highly sensitive commercial data** for multiple independent Turkish e-commerce businesses:

- **Marketplace API credentials** (Trendyol, Hepsiburada) — if leaked, attacker can access seller accounts, manipulate orders, download customer data, issue refunds
- **Order & customer data** — financial transactions, customer names, delivery addresses
- **Cost/margin data** — a seller's product cost prices are competitive intelligence; leakage to competitors is catastrophic
- **Financial settlements** — revenue, commissions, net profit figures

**Assumed adversaries:**

- Other tenants on the same platform (most common threat — curiosity or malice)
- Malicious insiders (rogue team members within an org)
- External attackers with valid auth tokens (session hijacking, credential stuffing)
- Internal bugs causing accidental cross-tenant data exposure (most dangerous in practice)

**Core invariant:** A user MUST NEVER see or modify data belonging to an organization they are not a member of, or a store they are not authorized for. There are ZERO valid exceptions to this rule.

---

## 2. Data Isolation (Multi-Tenancy)

### The Absolute Rule

> Every user can only access data belonging to organizations where they have an active `OrganizationMember` record. This is enforced at THREE independent layers. All three MUST be in place simultaneously.

### Layer 1 — Application (Middleware)

Every API request passes through `orgContextMiddleware` which:

1. Extracts `orgId` from URL params
2. Verifies the authenticated user has a membership in `organization_members` for that `orgId`
3. If no membership exists → return `403 Forbidden` (not 404 — don't confirm existence)
4. Injects `organizationId` into request context
5. Every subsequent DB query in the request uses this `organizationId`

```typescript
// ❌ Bad — trusts URL param without membership check
app.get('/organizations/:orgId/orders', async (c) => {
  const orgId = c.req.param('orgId');
  return prisma.order.findMany({ where: { organizationId: orgId } });
});

// ✅ Good — middleware verifies membership first
app.use('/organizations/:orgId/*', authMiddleware, orgContextMiddleware);
app.get('/organizations/:orgId/orders', async (c) => {
  const orgId = c.get('organizationId'); // guaranteed user is member
  return prisma.order.findMany({ where: { organizationId: orgId } });
});
```

### Layer 2 — Database (Row-Level Security)

PostgreSQL RLS policies are the last line of defense. Even if application code forgets to filter, RLS blocks the query.

```sql
-- Applied to EVERY tenant-scoped table
CREATE POLICY "tenant_isolation" ON orders
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );
```

RLS is a **defense-in-depth** mechanism, not a substitute for application-layer filtering. Both must be present.

### Layer 3 — Schema Design

Every tenant-scoped table has:

- `organization_id UUID NOT NULL` — never nullable
- Foreign key to `organizations(id)` with `ON DELETE CASCADE`
- Index on `organization_id` for query performance
- Composite unique constraints include `organization_id` or a tenant-scoped parent ID

```prisma
// ❌ Bad — orders without organization_id
model Order {
  id     String @id @default(uuid()) @db.Uuid
  storeId String @map("store_id") @db.Uuid
  // ... where's organization_id?
}

// ✅ Good — explicit organization_id on every tenant table
model Order {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  storeId        String   @map("store_id") @db.Uuid
  // ...
  @@index([organizationId])
}
```

### What This Prevents

- Attacker changes `:orgId` in URL → middleware rejects
- Buggy service forgets `organizationId` filter → RLS blocks query
- Data migration script targets wrong tenant → FK and index ensure errors surface

---

## 3. Store-Level Authorization

Within a single organization, a user's access to stores is further restricted. Even if a user is a member of an organization, that does NOT automatically grant access to every store in that organization.

### Role Matrix (within an Organization)

| Action                    | OWNER | ADMIN | MEMBER | VIEWER |
| ------------------------- | :---: | :---: | :----: | :----: |
| View dashboard & reports  |   ✓   |   ✓   |   ✓    |   ✓    |
| View orders & products    |   ✓   |   ✓   |   ✓    |   ✓    |
| Manage expenses           |   ✓   |   ✓   |   ✓    |   ✗    |
| Update product costs      |   ✓   |   ✓   |   ✓    |   ✗    |
| Run reconciliation        |   ✓   |   ✓   |   ✗    |   ✗    |
| Connect/disconnect stores |   ✓   |   ✓   |   ✗    |   ✗    |
| Manage team members       |   ✓   |   ✓   |   ✗    |   ✗    |
| Change org settings       |   ✓   |   ✓   |   ✗    |   ✗    |
| Delete organization       |   ✓   |   ✗   |   ✗    |   ✗    |
| Manage billing            |   ✓   |   ✗   |   ✗    |   ✗    |

### Role Check Pattern

```typescript
// ❌ Bad — role check happens in UI only (frontend can be bypassed)
{memberRole === 'OWNER' && <Button onClick={deleteStore}>Delete</Button>}

// ✅ Good — role check in backend middleware/service
export function requireRole(...roles: MemberRole[]) {
  return createMiddleware(async (c, next) => {
    const role = c.get('memberRole');
    if (!roles.includes(role)) {
      throw new ForbiddenError('Insufficient permissions');
    }
    await next();
  });
}

// Route declaration
app.post(
  '/organizations/:orgId/stores',
  authMiddleware,
  orgContextMiddleware,
  requireRole('OWNER', 'ADMIN'),
  storeController.create,
);
```

### Store Scope Enforcement

Every store-scoped query MUST verify the store belongs to the current organization:

```typescript
// ❌ Bad — uses storeId from URL without verifying ownership
async function getOrders(storeId: string) {
  return prisma.order.findMany({ where: { storeId } });
}

// ✅ Good — verify store → org mapping before any operation
async function getOrders(orgId: string, storeId: string) {
  const store = await prisma.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    select: { id: true },
  });
  if (!store) {
    throw new NotFoundError('Store'); // 404, not 403 — don't confirm store exists in another org
  }
  return prisma.order.findMany({
    where: { storeId: store.id, organizationId: orgId },
  });
}
```

---

## 4. Credential Storage & Encryption

### The Rule

> Marketplace API credentials (Trendyol API keys, Hepsiburada secrets, seller IDs, etc.) are **NEVER stored in plaintext**, **NEVER logged**, and **NEVER returned in API responses**. They are decrypted ONLY at the moment of making a marketplace API call, and only in server-side memory.

### Encryption Standard

- Algorithm: **AES-256-GCM** (authenticated encryption)
- Key source: `ENCRYPTION_KEY` environment variable (32 bytes, base64-encoded)
- Key management: stored in secrets manager (Supabase Vault / Vercel env / AWS Secrets Manager), never in code or git
- IV (initialization vector): randomly generated per record, stored alongside ciphertext
- Auth tag: stored alongside ciphertext to detect tampering

### Encryption Contract

```typescript
// apps/api/src/lib/encryption.ts
export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptCredentials(plaintext: Record<string, unknown>): EncryptedPayload;
export function decryptCredentials(encrypted: EncryptedPayload): Record<string, unknown>;
```

### Storage

```prisma
model Store {
  // credentials column stores the EncryptedPayload JSON
  // never plaintext credentials
  credentials Json
}
```

Example of stored value:

```json
{
  "ciphertext": "V8f2...base64...",
  "iv": "7xK9...base64...",
  "authTag": "9aPq...base64..."
}
```

### Usage Rules

```typescript
// ❌ Bad — credentials logged, exposed in response, passed around plaintext
console.log('Syncing with creds:', creds); // LOG LEAK
return c.json({ store: { ...store, credentials: creds } }); // API LEAK

// ✅ Good — decrypt only in the marketplace adapter, scope narrowly
async function syncTrendyolOrders(store: Store): Promise<void> {
  const credentials = decryptCredentials(store.credentials as EncryptedPayload);
  const adapter = new TrendyolAdapter(credentials);
  try {
    const orders = await adapter.fetchOrders();
    await saveOrders(store.organizationId, store.id, orders);
  } finally {
    // Credentials go out of scope; no persistent reference
  }
}

// ✅ Good — API responses strip credentials
function toStoreResponse(store: Store): StoreResponse {
  const { credentials, ...safe } = store;
  return safe; // credentials never leave the server
}
```

### Rotation

- `ENCRYPTION_KEY` must be rotatable without downtime (re-encrypt in batch migration)
- Marketplace API keys should be rotated when a team member with access leaves
- Provide a UI flow for users to update their API credentials (never "reveal current")

---

## 5. Sensitive Data Protection

### What Counts as Sensitive

All data tied to an organization is sensitive, but these require extra care:

| Data                              | Sensitivity  | Why                                                  |
| --------------------------------- | ------------ | ---------------------------------------------------- |
| API credentials                   | **CRITICAL** | Leak = marketplace account takeover                  |
| Product cost prices               | **HIGH**     | Competitive intelligence — competitor advantage      |
| Customer names/addresses (orders) | **HIGH**     | PII under KVKK/GDPR                                  |
| Settlement/revenue figures        | **HIGH**     | Commercial confidentiality                           |
| Product titles, barcodes          | Medium       | Public-ish but enables scraping/competitive analysis |
| Organization name, team members   | Medium       | Privacy of business relationships                    |

### Rules

- **No sensitive data in URLs.** Use request body or headers. URLs are logged by Vercel, proxies, browser history.
- **No sensitive data in error messages** returned to users. Log server-side, return generic message client-side.
- **No sensitive data in analytics/monitoring tools.** Scrub before sending to Sentry, DataDog, etc.
- **No cost prices in `GET` endpoints accessed by VIEWER role** — role matrix applies to field-level visibility too.
- **No bulk export without audit log entry.**

```typescript
// ❌ Bad — cost price in URL, leaked to logs
GET /stores/123/products?cost_price=29.99

// ❌ Bad — leaks store existence across tenants
if (!store) return c.json({ error: 'You are not authorized to access this store' }, 403);

// ✅ Good — data in body, generic errors
POST /stores/123/products/bulk-cost { updates: [{ productId, costPrice }] }
if (!store) return c.json({ type: '.../not-found', title: 'Not Found', status: 404 }, 404);
```

---

## 6. API Security

### Authentication

- All API endpoints (except `/health`, `/auth/signup`, `/auth/signin`) require a valid Supabase JWT
- JWT is verified on every request using `JWT_SECRET` (HS256)
- Expired tokens → `401 Unauthorized` (client must refresh)
- Invalid tokens → `401 Unauthorized`, NEVER log the token value

### Transport

- **HTTPS only** in production. HTTP requests are redirected or rejected.
- HSTS header with `max-age=31536000; includeSubDomains`
- Secure, HttpOnly, SameSite=Lax cookies for session state (if used)

### CORS

- Whitelist exact frontend origins, never `*`
- Credentials mode enabled only for whitelisted origins

### Rate Limiting

- Per-IP: 100 requests/minute baseline
- Per-authenticated-user: 300 requests/minute
- Marketplace sync endpoints: 10 requests/minute (to prevent abuse that could trigger marketplace rate limits on the seller's behalf)

### Input Validation

- Every request body/query/param validated with Zod
- Unknown fields rejected (`.strict()`)
- Size limits on all endpoints (default: 1MB body)

---

## 7. Database Security (RLS)

### Enable RLS on ALL tenant tables

```sql
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;
```

### Standard Policy Template

```sql
CREATE POLICY "tenant_isolation" ON <table>
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );
```

### Service Role Bypass

The backend uses the Supabase **service role key** to connect, which bypasses RLS. This is intentional — we rely on application middleware to inject `organization_id`. But:

- The service role key MUST be treated as a root secret (env var, never in code)
- RLS is still the backup if middleware has a bug
- Edge Functions also use service role; they must manually enforce tenant scope

### Connection Security

- Use connection pooling with SSL (`sslmode=require`)
- Never expose the database port publicly
- Read replicas (if added) inherit the same RLS policies

---

## 8. Logging & Audit

### What to Log

- Authentication events (sign in, sign out, failed attempts)
- Store connection/disconnection
- Credential updates
- Role changes (add/remove member, change role)
- Bulk operations (cost price updates, expense imports)
- Failed authorization attempts (403s)

### What NEVER to Log

- API credentials (raw or encrypted)
- JWT tokens
- Passwords (even hashed)
- Customer PII (use IDs only)
- Full request bodies containing sensitive fields

```typescript
// ❌ Bad — logs include sensitive fields
logger.info('Store connected', { store, credentials });

// ✅ Good — log IDs and non-sensitive metadata
logger.info('Store connected', {
  storeId: store.id,
  orgId: store.organizationId,
  platform: store.platform,
  actorUserId: userId,
});
```

### Audit Log Table

For high-value operations, write to a dedicated `audit_logs` table (not yet in schema — add when auth features ship):

```
audit_logs (
  id, organization_id, user_id, action, resource_type, resource_id,
  before_state, after_state, ip_address, user_agent, created_at
)
```

---

## 9. Security Review Checklist

Before merging any PR that touches user data, credentials, or cross-tenant code:

### Query Safety

- [ ] Every `prisma.*.findMany`, `findFirst`, `findUnique`, `update`, `delete` includes `organizationId` in the `where` clause (or is explicitly marked as a public/admin query)
- [ ] Store-scoped queries verify `storeId` belongs to the current `organizationId`
- [ ] No raw SQL with string concatenation (use parameterized queries or Prisma)

### Credentials

- [ ] Any new credential storage uses the `encryptCredentials`/`decryptCredentials` helpers
- [ ] Credentials never appear in API responses (use `toStoreResponse`-style mappers)
- [ ] Credentials never appear in logs (grep the PR for `credentials`, `apiKey`, `secret`, `token`)
- [ ] Env vars (`ENCRYPTION_KEY`, `JWT_SECRET`, `SUPABASE_SECRET_KEY`) are not committed

### Authorization

- [ ] New routes are protected by `authMiddleware` + `orgContextMiddleware`
- [ ] Role-gated actions use `requireRole()` middleware
- [ ] Frontend role checks are duplicated in backend (never trust the client)

### API Responses

- [ ] No sensitive field bleed-through (use explicit response types, not `...entity`)
- [ ] Error messages don't confirm the existence of resources in other tenants
- [ ] Response bodies validated against expected schema before returning

### RLS

- [ ] New tables have `organization_id` column and RLS policy enabled
- [ ] Migration file includes the RLS policy SQL
- [ ] RLS tested with a second tenant to confirm isolation

### Transport

- [ ] No HTTP-only flows added
- [ ] CORS origins are explicit, not wildcarded
- [ ] No sensitive data in query params or URL segments

---

## Incident Response

If a potential data leak or credential exposure is discovered:

1. **STOP merging** — freeze deployments immediately
2. Notify the security owner (TBD — designate a role holder)
3. Identify scope: which records, which tenants, which fields
4. If credentials are involved: invalidate/rotate them via marketplace APIs, notify affected users
5. If tenant isolation is broken: rotate `ENCRYPTION_KEY`, audit logs for cross-tenant queries
6. Post-mortem: add a test case that would have caught this, update this document
