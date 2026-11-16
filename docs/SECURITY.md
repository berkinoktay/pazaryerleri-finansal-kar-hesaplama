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

- All API endpoints (except `/v1/health`, `/v1/openapi.json`, `/v1/docs`) require a valid Supabase JWT in the `Authorization: Bearer <jwt>` header.
- Tokens are verified by delegating to `supabase.auth.getUser(token)` via the Supabase JS SDK using `SUPABASE_SECRET_KEY`. The SDK handles signature verification, algorithm selection (HS256 / ES256), claim validation (`aud`, `iss`, `exp`), and stays current with Supabase Auth's evolving token format — no custom JWT crypto in this codebase.
- Expired tokens → `401 Unauthorized` (client must refresh).
- Invalid tokens → `401 Unauthorized`, NEVER log the token value.

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


### File Uploads (Excel workbooks)

Seller-uploaded `.xlsx` files are untrusted input. One malformed file can take the API process down for every tenant, and an export hands a stored upload back byte for byte to whoever exports it, so the campaign workbook path (`apps/api/src/workbooks/`, engine `@pazarsync/spreadsheet`) is defence-in-depth:

- **Before the body is read.** Import routes declare `createRoute({ middleware: WORKBOOK_IMPORT_MIDDLEWARE })` (`apps/api/src/middleware/workbook-upload.middleware.ts`), in this order: the per-user `FILE_IMPORT` rate limit; store access + `DATA_WRITE` (`storeAccessMiddleware`); a `multipart/form-data` check (415, a free header check that runs before any body byte is counted); a body limit of `WORKBOOK_UPLOAD_MAX_BYTES` (`@pazarsync/utils`) plus `MULTIPART_OVERHEAD_BYTES` (413 `PAYLOAD_TOO_LARGE`). Export routes carry `WORKBOOK_EXPORT_MIDDLEWARE`: the `FILE_EXPORT` rate limit, then store access + `DATA_WRITE`. Handlers (`apps/api/src/workbooks/route-factory.ts`) still call `requireStoreAccessContext`, so a skipped middleware can never leave a handler unauthorised.
- **Ids come from the verified store record.** A handler re-parses the path ids only to call `requireStoreAccessContext`; `importWorkbook` and `exportWorkbook` get `store.id`, `store.organizationId` and `store.platform` of the record the middleware verified, never the raw path strings (the path schema accepts an upper-case UUID while Postgres stores lower case, so a lock key or a scope built from the path would follow the caller's spelling). An export's record id is the validated path parameter.
- **The gate (`openUpload`, `packages/spreadsheet/src/guards.ts`; the full order is the doc comment of `openUploadWithLayout`).** Byte cap; zip magic; `readZipLayout`, the only archive shape the export accepts (no gap, overlap, hidden entry, archive comment or zip64); canonical entry names; unsafe part names; a streaming inflate that keeps only XML content, with real-byte ceilings (entry count, `MAX_DECOMPRESSED_BYTES`, `MAX_XML_TOTAL_BYTES`, `MAX_WORKBOOK_RELS_BYTES` for `_rels/.rels`); the required parts; the central directory sizes against the streamed ones; the encoding of every entry; unsafe package parts; the content scan of every kept XML part; the reader parts (DOM weight, element-name length, namespace declarations, the workbook rels cap); the same bytes again through a second inflater (`assertSameViews`); the root relationships part must name `xl/workbook.xml`.
  - **Unsafe package parts** (`packages/spreadsheet/src/unsafe-parts.ts`) answer `UNSAFE_CONTENT`: a macro project, macro or dialog sheets, embedded objects and packages, ActiveX controls, external links, data connections and query tables, web add-ins, custom UI, XML maps, a digital signature, and any relationship that loads content from outside the package (a worksheet hyperlink to `http`, `https` or `mailto` excepted). They are found the way Excel finds them: by the content types (`UNSAFE_CONTENT_TYPE_MARKERS`) and by the relationship type in every relationships part, chosen by content as well as by name (`UNSAFE_RELATIONSHIP_TYPE_ENDINGS`). The part name (`UNSAFE_PART_NAMES`, `UNSAFE_PART_PREFIXES` in `workbook-parts.ts`) is only a second line: a relationship Target is free text.
  - **Formulas** (`packages/spreadsheet/src/content-scan.ts`, `formula-scan.ts`) answer `UNSAFE_CONTENT` unless every call names a function of the allow list `SAFE_FORMULA_FUNCTIONS` (pure math, text, logical, lookup and date functions; `WEBSERVICE`, `HYPERLINK`, `INDIRECT`, `RTD`, every `IMPORT*` name and every unknown name are outside it). Every formula field of every scanned XML part is read, not only the `f` of a cell: defined names, data validations, conditional formats, table and pivot formulas, chart series, shape and control links (`FORMULA_ELEMENT_NAMES`, `FORMULA_ATTRIBUTE_NAMES`). A field is decoded first (character references replaced) and read twice, as stored and in NFKC form. The `_xlfn.` and `_xlws.` prefixes are removed before a name is compared, and any other internal `_xl` prefix is refused (except an uncalled `_xlchart.` name, the hidden name a newer chart reads its data through). An `_xHHHH_` escape, a DDE link (`|`), a reference into another workbook, a call of an expression's result, and anything but text inside a field are refused too: a comment, CDATA, a processing instruction or a child element (except the one `<xm:f>` Excel 2010+ writes). The fields of one upload share the budget `MAX_FORMULA_SCAN_UNITS`.
  - **The rest of the content scan** refuses a DTD or entity declaration, an unknown entity reference, a macro assignment, an active element or event handler, and a URL outside the package (`UNSAFE_CONTENT`).
  - **Not scanned as formulas:** cell values. A string that starts with `=`, `+`, `-` or `@` is stored as text, which Excel shows and never evaluates, and it passes (`content-scan.test.ts`, "accepts formula-looking string values").
- **The grid reader (`readGrid`, `packages/spreadsheet/src/read-grid.ts`)** parses each part the reader opens once, strictly, and runs the part checks (`checkPart`) before any reader work on it. Cell references are validated and capped, the grid is never sized from a declared `<dimension>`, and an over-long number format is refused. A cell whose style index names no `cellXfs` entry, and an `AlternateContent` element inside the sheet data, are `CORRUPT_FILE`. One DOM is alive at a time, and nothing is re-serialized.
- **Strict sheet selection.** The pipeline reads a sheet only with the strict selector (each format's `sheet`, passed as `readWorkbookGrid(file, { sheet })`): a missing sheet is `SHEET_NOT_FOUND` and a sheet that breaks a reader rule is `CORRUPT_FILE`, never another sheet, so nothing is ever patched into a sheet the format did not identify. `selectFormat` (`apps/api/src/workbooks/select-format.ts`) tries the page's formats for the store's platform (none: `UNSUPPORTED_PLATFORM_FORMAT`). When none fits, the outcome follows the order in the `selectFormat` doc comment; among them, `diagnoseWorkbook` compares the header row with the fingerprints of the other pages' formats (`FORMAT_SUMMARIES`, at least `FINGERPRINT_MIN_HEADERS` hits) and the upload is refused as `WRONG_FILE_FOR_PAGE` on every page, with `meta.detectedPage` naming the page when one matches and null when none does.
- **An import rehearses the export.** After reading the rows, when at least one write column resolves, `importWorkbook` (`apps/api/src/workbooks/import-workbook.ts`) runs one `patchWorkbook` job on the uploaded bytes and drops its output. The job writes the largest value each write column can receive (`probeValue`, `write-columns.ts`) into every row the export may patch (`rehearsalTargets`, `rehearsal.ts`). A file the export would refuse for a structural reason (a shared or array formula or a merged range over a write column, the growth cap) is therefore refused at upload, not at its first export. The upload also refuses values the export could not write back: a value an export may write must pass the export's own rule (`requireWritableValue`, `MALFORMED_SHEET` reason `unwritable-value`), a number must fit its column (`requireStorableInt` in `column-range.ts`, and a Postgres out-of-range error at the insert), an anchor cell must stay within `MAX_ANCHOR_TEXT_LENGTH` and no text cell may hold U+0000 (`readRows`, `import-rows.ts`), a stored date must fall within the years 1900 to 9999 (`requireStorableInstant`), and a tariff file may hold no zero-day period and at most seven periods (`requireTariffPeriods`, `tariff-week.ts`). Any other data exception Postgres raises while the rows are written is mapped the same way (`rethrowPersistError`, `import-workbook.ts`; the log carries the page and the SQLSTATE only). Each is a 422 on `file`, and nothing is stored.
- **One import per store and page, and an upload quota** (`apps/api/src/workbooks/upload-quota.ts`), both inside the import transaction before anything is written:
  - `acquireImportLock` takes a transaction-scoped advisory lock without waiting (`pg_try_advisory_xact_lock` over `hashtextextended(importLockKey(...), WORKBOOK_IMPORT_LOCK_SEED)`); the key is the verified store record's id and the page. A second import of the same store and page answers 409 with `code` `IMPORT_IN_PROGRESS`.
  - `assertUploadQuota` answers 409 with `code` `UPLOAD_QUOTA_EXCEEDED` when the page already holds `MAX_LISTS_PER_STORE_PAGE` lists in the store (the adapter's typed `countLists`, scoped by `organizationId` and `storeId`), or when the store's stored source bytes over every workbook parent table (`WORKBOOK_PARENT_TABLES`) plus the upload would exceed `STORE_UPLOAD_QUOTA_BYTES`. The byte sum is one static `Prisma.sql` text with every table name written out (`storedUploadBytesSql`); only the two ids are bound. No workbook SQL takes an identifier from a variable (no `Prisma.raw`); an adapter's `parentTable` is data for tests and logs only.
- **Scoped reads and follow-up writes.** An adapter's `load` is one `findFirst` with `{ id, organizationId, storeId }`. Every follow-up write of a parent row (the export's `exportedAt` touch, the parent updates and deletes of each page's service in `apps/api/src/services/`) is an `updateMany` or `deleteMany` with `{ id, organizationId, storeId }`, awaited through `assertScopedWrite` (`apps/api/src/workbooks/scoped-write.ts`): a count other than 1 is a 404. Item writes carry `organizationId`, `storeId` and their parent's id (for a tariff item, through its period's tariff id).
- **The export patcher contract** (`patchWorkbook`, `packages/spreadsheet/src/patch/`). `exportWorkbook` patches the stored file through the engine's `patchWorkbook`, which runs the job in the parse worker (`patchUpload` behind `runOnGridWorker`): every step that unzips, parses or rewrites the file runs there. The API main thread only validates the request (`resolvePatchRequest`), plans the patches (`planExport`) and, for several output files, stores them in one `.zip` without compressing them again (`download.ts`).
  - Before any byte is written, the job runs the gate again, the reader with the format's strict selector, the caller's anchors (`ROW_ANCHOR_MISMATCH`, `ROW_NOT_FOUND`) and a reader/index cross-check, and refuses a target inside a merged range or an array or data table formula range. The worksheet is indexed by a strict byte lexer in one linear pass (`patch/sheet-index.ts`, `patch/xml-lexer.ts`), so a comment full of unterminated `<row` starts cannot make it scan the part once per occurrence.
  - It writes only values validated against the format's write rules (`assertPlannedWriteValue`, `write-columns.ts`; a stored value that fails it, from a list stored before the upload checked its values, answers 409 `STORED_FILE_UNREADABLE`, never 500): plain non-negative decimal numbers, and texts from a closed vocabulary (an allow list, or a pattern such as the tariff window label). It never writes a user-supplied string or a formula into a cell; a formula cell is overwritten only in a column the format marks `overwritesFormula`.
  - It is byte-preserving and touches only the page's own sheet: it replaces the worksheet part of the format's sheet and copies every other entry as raw bytes, except that overwriting a formula also cuts the calcChain from the workbook rels and the content types (`calcChainChanges`, `patch/patch-upload.ts`). A patched part is bounded by a growth cap, and all outputs of one job by `MAX_PATCH_OUTPUT_TOTAL_BYTES`.
- **Isolation of the parse.** Every read and every patch runs in one `worker_threads` worker with a heap limit (`GRID_WORKER_MAX_OLD_GENERATION_MB`, plus a young-generation limit) and a wall-clock timeout (`GRID_WORKER_TIMEOUT_MS`).
  - **Kills.** On an upload, a kill for memory or for time answers 422 `PAYLOAD_TOO_LARGE` on `file` (`toUploadError`, `apps/api/src/workbooks/workbook-errors.ts`). Every step is linear, so a parse past the time limit is the file, and a retryable answer would invite retries that each hold the worker. On a stored file (an export's read or patch) a kill answers 409 with `code` `STORED_FILE_UNREADABLE` (`toStoredFileError`), not retryable. In each case the worker is respawned for the next job.
  - **Queue.** Reads and patches share one queue: one job at a time, a refusal at once beyond `MAX_QUEUED_PARSES` jobs in flight, and a give-up after `PARSE_QUEUE_MAX_WAIT_MS` of waiting. That `ENGINE_BUSY` is the only engine outcome that answers 503 (`IMPORT_BUSY` with `Retry-After`); the routes' other 503 is an import transaction that cannot get a database slot in time (`mapTransactionError`). One tenant's slow files therefore cannot hold every other tenant's import for minutes.
  - **The limits are a backstop, not the defence.** One allocation larger than the remaining heap headroom plus about 16 MB still aborts the whole process, and array buffers are not counted. The byte, DOM-weight and cell caps stay the primary defence. The in-budget peak is about 760 MB: about 570 MB of DOM, up to 64 MB of worksheet source, up to 64 MB of shared-string source and up to about 60 MB of grid text. That is why the worker's old generation is 1024 MB.
  - **Deployment.** The API process must not set `--max-old-space-size` (in `NODE_OPTIONS` or on the command line), because it overrides the worker limit. Give the container about 2 GB of memory (main heap plus worker).
- **Engine detail never reaches a response.** `toUploadError` and `toStoredFileError` drop the engine error's `meta`, which can name zip entries or quote library messages: an upload answers the engine `code` on `file`, a stored file a 409 whose `code` is one of the fixed workbook conflict codes (the literal table in `apps/api/src/lib/problem-details.ts`). The engine code and reason are logged (`workbook.upload-rejected`, `workbook.stored-file-rejected`), never a file name or a cell.
- **Names and download headers.** A typed list name goes through `NameSchema` (`apps/api/src/workbooks/form.ts`): trimmed, at most `UPLOAD_NAME_MAX_LENGTH` characters, and no control (`\p{Cc}`) or format (`\p{Cf}`) character such as a bidi override (`NAME_TOO_LONG`, `NAME_INVALID_CHARACTERS`; an empty rename is `NAME_REQUIRED`); a name taken from the file goes through `cleanDisplayName`. The discount and campaign window dates answer `INVALID_DATE` for a malformed value and `DATE_OUT_OF_RANGE` for a UTC year outside 1900 to 9999 (`WindowInstantSchema`), so no date reaches a column that cannot store it. The stored upload name goes through `sanitizeUploadFilename` (`sanitize-upload-filename.ts`): control, format and path separator characters dropped, NFC, `.xlsx` required (else no name is stored), cut to `UPLOAD_NAME_MAX_LENGTH` code points. The `name` and `source_filename` columns of every workbook parent table are `varchar(120)`. The raw upload name never reaches a response: `contentDisposition` sends an ASCII `filename` that keeps only letters, digits, space and `. _ ( ) -` (so a quote, a backslash or header parameter syntax never reaches it) beside an RFC 8187 `filename*`, and `downloadHeaders` (`download.ts`) adds `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The web client reads the saved name only from the header's own `filename*` and `filename` parameters (`filenameFromDisposition`, split at semicolons outside quotes), so header syntax inside a quoted name cannot choose the saved file name.
- **Never trust declared sizes.** Grid size, zip sizes and sheet dimensions in the file are attacker-controlled; caps are computed from what is actually parsed.
- **Stored bytes are private.** `source_file` columns are hidden from the scoped Supabase client by column privileges: the `source_file` block of `supabase/sql/rls-policies.sql` revokes table-level `SELECT` on each workbook parent table, grants it back column by column without `source_file`, and fails the apply if the column is still readable. Only the API (service role) reads them.
- **A deploy that tightens the gate runs the audit first.** `apps/api/scripts/audit-stored-workbooks.ts` (`AUDIT_DATABASE_URL=... pnpm --filter @pazarsync/api audit:stored-workbooks`, a direct or session connection) reads every stored file through the engine and the export's own steps (never `exportWorkbook` or `touchExported`, which write) on a read-only session (`default_transaction_read_only=on`, confirmed before any row is read), and prints only table names, counts, record and store ids, and engine codes and reasons: never a file name, a list name, a cell, the URL or its password. Run it against the live database before deploying a stricter gate; exit 1 (for example a stored file the new rules refuse, a name over the limit, a store over quota, or a fatal error) stops the deploy until the owner has decided.

## 7. Database Security (RLS)

Policies live in [`supabase/sql/rls-policies.sql`](../supabase/sql/rls-policies.sql). Applied automatically by `pnpm db:push` (which chains into `pnpm db:apply-policies`). Every tenant-scoped table has `ENABLE ROW LEVEL SECURITY` plus at least one SELECT policy. The coverage test in `apps/api/tests/integration/rls/coverage.rls.test.ts` fails CI if any table is missing.

### Role model

| Role                   | How the connection gets it                                 | RLS behavior                            |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------- |
| `postgres` (superuser) | `DATABASE_URL` as `postgres:postgres@…`                    | **Bypasses RLS entirely**               |
| `authenticated`        | Supabase JS client with `Authorization: Bearer <user JWT>` | RLS enforced; `auth.uid()` populated    |
| `anon`                 | Supabase JS client with no user JWT                        | RLS enforced; `auth.uid()` returns NULL |

The backend currently uses the `postgres` role via Prisma, so RLS does not filter backend queries. Phase A (shipped) makes RLS the **second** layer of tenant isolation — the primary layer is `orgContextMiddleware`'s explicit filters. RLS is still load-bearing:

- Blocks direct psql access to the database
- Blocks realtime subscribers from reading any tenant data
- Blocks anon-key clients from reading cross-tenant rows
- Protects against future code paths that use a non-superuser connection

Phase B (future plan) moves backend queries through a per-request `authenticated` role scoped via transaction, so RLS also filters backend queries directly. Deferred until service-function count grows and the refactor has a clean shape.

### Policy patterns

The `is_org_member(uuid)` helper — defined once in `rls-policies.sql` — is the canonical building block. `SECURITY DEFINER` makes it RLS-immune inside its own body, which breaks the infinite-recursion trap in "read rows where user is a member of the row's org".

```sql
-- Direct org tables (organization_id column):
USING (is_org_member(organization_id))

-- Reach-via-parent tables (order_items, settlement_items, sync_logs):
USING (EXISTS (
  SELECT 1 FROM <parent>
  WHERE <parent>.id = <this>.<parent_fk>
    AND is_org_member(<parent>.organization_id)
))

-- Self-scoped (user_profiles):
USING (id = auth.uid())
```

### Adding a new tenant-scoped table

1. Add the Prisma model, run `pnpm db:push` to create the table (this chains into `db:apply-policies`).
2. Append to [`supabase/sql/rls-policies.sql`](../supabase/sql/rls-policies.sql):
   ```sql
   ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS your_table_org_member_read ON your_table;
   CREATE POLICY your_table_org_member_read ON your_table
     FOR SELECT TO authenticated
     USING (is_org_member(organization_id));
   ```
3. Add the table's name to `TENANT_TABLES` in `coverage.rls.test.ts`.
4. Add an integration test in `apps/api/tests/integration/rls/<table>.rls.test.ts` using `createRlsScopedClient` (see existing files for the pattern).
5. `pnpm db:push && pnpm --filter @pazarsync/api test:integration -- rls` — all green before PR.

**RLS is never deferred to a later PR.** Every PR that adds or modifies a tenant table includes its RLS story.

### Connection security

- Use connection pooling with SSL (`sslmode=require`) in production
- Never expose the database port publicly
- Read replicas (if added) inherit the same RLS policies

### Test secrets policy

Values hardcoded inline in `.github/workflows/ci.yml` are scoped to Supabase local's well-known ephemeral defaults (JWT signing key auto-generated per container, `0xDEADBEEF`-style encryption key for tests). They are not production secrets and cannot be used to access anything beyond a CI job's own temporary DB.

Real secrets (production Supabase service key, Sentry DSN, deployment credentials) live in GitHub Secrets (referenced via `${{ secrets.NAME }}`), never inline. Rule of thumb: if the value would compromise anything non-ephemeral when leaked, it's a secret — store it in GitHub Secrets.

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
- [ ] Env vars (`ENCRYPTION_KEY`, `SUPABASE_SECRET_KEY`, database connection strings) are not committed
- [ ] Test-only hardcoded values in `.github/workflows/ci.yml` are scoped to Supabase local (ephemeral, non-production) defaults — no real secrets inline in workflow files

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

### File Uploads

- [ ] Upload routes authorise and cap the body in route middleware, before the form validator buffers it
- [ ] Parsed files go through `@pazarsync/spreadsheet` (never a raw xlsx/xml parser on user bytes)
- [ ] Sizes, counts and dimensions declared inside the file are never trusted
- [ ] Stored raw files are not readable through the scoped Supabase client
- [ ] Unsafe package parts (found by content type and relationship type, not only by name) and formulas outside the allow list are refused at the gate, on uploads and stored files alike
- [ ] An import rehearses the export (`patchWorkbook` on the upload), so a file the export would refuse for a structural reason is refused at upload, and a value the export could not write back is refused there too
- [ ] Every workbook query and follow-up write is scoped by `organizationId` and `storeId` (`updateMany`/`deleteMany` through `assertScopedWrite`), with ids taken from the verified store record, never from the raw path
- [ ] Raw SQL takes no identifier from a variable: table names are written out in static `Prisma.sql` text, only values are bound (no `Prisma.raw`)
- [ ] Typed names go through `NameSchema` and stored upload names through `sanitizeUploadFilename`; a download's `Content-Disposition` comes from `contentDisposition`
- [ ] An engine error's `meta` never reaches a response (`toUploadError`, `toStoredFileError`)
- [ ] Every rule a workbook route adds sets its message to a machine code (never a library sentence as the issue code)
- [ ] A deploy that tightens the gate runs `apps/api/scripts/audit-stored-workbooks.ts` against the live database first, and an exit code of 1 stops it

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
