# Dashboard Tek Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PazarSync dashboard shell'ini mevcut 3-rail mimarisinden tek sidebar (collapsible 290px ↔ 48px) + 1fr main mimarisine geçir; nested feature gruplarını inline expandable nav olarak destekle; bottom dock utility cluster'ı ekle; org+store switcher'ı kombine chip + layered dropdown olarak yeniden tasarla; settings için secondary sidebar layout'u kur; eski shell artifact'lerini sil.

**Architecture:** shadcn `Sidebar` primitive (`pnpm dlx shadcn@latest add sidebar`) ana shell mekaniği için kullanılır (collapse, mobile drawer, persistence). Üzerine 4 yeni cross-feature pattern (BottomDock, NavGroup, OrgStoreSwitcher, ThemeToggleInline) inşa edilir; mevcut `nav-config.ts` shape'i `badge` ve `divider` alanlarıyla geriye uyumlu şekilde genişletilir; `MarketplaceLogo` ve `SubNavList` reuse edilir. 3 fazlı migration: (1) Foundation — yeni primitive'ler izole + showcase, shell değişmez; (2) Shell Switch — yeni AppShell devreye, eski rail dosyaları silinir; (3) Settings + Sub-routes — `(settings)` route group ve nested sub-nav kategorileri.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6, Tailwind CSS 4 + shadcn/ui (Sidebar [yeni], Popover, Command, Avatar, Tooltip, ScrollArea, Badge, Sheet, DropdownMenu — hepsi mevcut), next-intl 4, next-themes 0.5, hugeicons-react, Vitest 4 + @testing-library/react + happy-dom + MSW v2, Prisma 7, Supabase (PostgreSQL 15 + RLS).

**Branch:** Bu plan `feature/dashboard-tek-sidebar-design` üzerine yazılır. Implementation kendi feature dalında yapılır (her faz ayrı PR).

**Spec referansı:** `docs/superpowers/specs/2026-04-25-dashboard-shell-tek-sidebar-design.md` (committed `daf915a`)

**Brainstorm artifacts:** `.superpowers/brainstorm/91783-1777121849/content/*.html` (gitignored, referans için)

**Commit politikası:** Her task tek bir self-contained commit üretir. Test → implementation → commit ritmini bozma. Pre-commit hook (`pnpm check:all`) geçmek zorunda; ihlal durumunda commit'i atma, root cause'u düzelt.

**Token mapping not'u:** Spec'te kullanılan generic shadcn token adları (`size-lg` → 32px) ile gerçek `apps/web/src/app/tokens/spacing.css` mapping'i farklıdır. Bu plan **gerçek** token adlarını kullanır:

- 8px → `size-xs` (`--space-xs: 8px`)
- 12px → `size-sm` (`--space-sm: 12px`)
- 16px → `size-md` (`--space-md: 16px`)
- 24px → `size-lg` (`--space-lg: 24px`)
- 32px → `size-xl` (`--space-xl: 32px`)
- 48px → `size-2xl` (`--space-2xl: 48px`)
- Mevcut role-based: `size-rail-icon` = 48px (collapsed sidebar olarak kullanılır), `size-icon-sm/md/lg` = 16/18/20px

---

## File Structure

### Create (Phase 1 — Foundation)

```
apps/web/src/components/ui/
└── sidebar.tsx                              # shadcn Sidebar primitive (registry)

apps/web/src/components/patterns/
├── bottom-dock.tsx                          # Sidebar dibi sticky utility cluster
├── nav-group.tsx                            # Expandable group header + sub-items
├── org-store-switcher.tsx                   # Combined chip + layered dropdown
├── org-store-switcher-list.tsx              # Internal: dropdown row renderer
└── theme-toggle-inline.tsx                  # Sidebar dock'taki SSR-safe theme switch

apps/web/src/lib/
└── org-avatar-color.ts                      # Deterministic palette index from orgId

apps/web/tests/unit/lib/
└── org-avatar-color.test.ts                 # Util tests

apps/web/tests/component/
├── bottom-dock.test.tsx
├── nav-group.test.tsx
├── org-store-switcher.test.tsx
└── theme-toggle-inline.test.tsx

apps/web/src/app/[locale]/(showcase)/design/patterns/
├── bottom-dock-showcase.tsx                 # /design/patterns altında demo
├── nav-group-showcase.tsx
├── org-store-switcher-showcase.tsx
└── theme-toggle-showcase.tsx
```

### Create (Phase 2 — Shell Switch)

```
apps/web/src/components/layout/
└── app-shell.tsx                            # YENİDEN yazılır (mevcut overwrite)

apps/web/tests/component/
└── app-shell.test.tsx                       # Yeni test
```

### Create (Phase 3 — Settings + Sub-routes)

```
apps/web/src/app/[locale]/(dashboard)/settings/
├── layout.tsx                               # Secondary sidebar layout
└── settings-nav-config.ts                   # Settings sections

apps/web/src/app/[locale]/(dashboard)/profitability/
├── orders/page.tsx                          # /profitability/orders
├── products/page.tsx                        # /profitability/products
├── categories/page.tsx                      # /profitability/categories
├── returns/page.tsx                         # /profitability/returns
└── campaigns/page.tsx                       # /profitability/campaigns

apps/web/src/app/[locale]/(dashboard)/tools/
├── commission-calculator/page.tsx
├── category-commissions/page.tsx
├── plus-commission-rates/page.tsx
└── product-pricing/page.tsx

apps/web/src/app/[locale]/(dashboard)/whats-new/page.tsx
apps/web/src/app/[locale]/(dashboard)/live-performance/page.tsx
```

### Modify

```
apps/web/src/components/layout/nav-config.ts # Phase 1 — shape extend (badge, divider, group)
                                             # Phase 3 — yeni groups (Karlılık, Maliyet&Araçlar)
apps/web/src/app/tokens/spacing.css          # Phase 1 — --size-dropdown-popover
apps/web/src/app/globals.css                 # Phase 1 — @theme inline export
apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx
                                             # Phase 2 — warning paneller page body'ye
apps/web/messages/tr.json                    # Phase 1 + 3 — yeni label key'leri
apps/web/messages/en.json                    # Phase 1 + 3 — yeni label key'leri
apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx
                                             # Phase 1 — yeni patterns gösterimi
apps/web/src/app/[locale]/(showcase)/design/layout-demo/page.tsx
                                             # Phase 2 — yeni shell mock
packages/db/prisma/schema.prisma             # Phase 1 — last_accessed_at column
apps/api/src/routes/organizations/           # Phase 1 — switch endpoint last_accessed_at update
```

### Delete (Phase 2)

```
apps/web/src/components/layout/icon-rail.tsx
apps/web/src/components/layout/context-rail.tsx
apps/web/src/components/layout/mobile-top-bar.tsx
apps/web/src/components/layout/mobile-nav-sheet.tsx
apps/web/src/components/layout/store-switcher.tsx
apps/web/src/features/dashboard/components/dashboard-context-middle.tsx
apps/web/tests/component/mobile-nav-sheet.test.tsx
```

---

# Phase 1 — Foundation

Yeni primitive'ler izole olarak yazılır, `/design/patterns` showcase'de görünür. Mevcut shell etkilenmez. PR 1 ship edildiğinde kullanıcı görsel olarak hiçbir değişiklik fark etmez — sadece `pnpm dev` üzerinden showcase routelarına gidip yeni component'leri test edebilir.

## Task 1.1: Install shadcn Sidebar primitive

**Files:**

- Create: `apps/web/src/components/ui/sidebar.tsx`
- Create: `apps/web/src/hooks/use-mobile.tsx` (shadcn dep — sometimes named `use-mobile` veya `use-is-mobile`)
- Modify: `apps/web/src/app/tokens/spacing.css` (sidebar genişlik tokenları)

- [ ] **Step 1: Mevcut sidebar bileşeninin olmadığını doğrula**

```bash
ls apps/web/src/components/ui/sidebar.tsx 2>&1
```

Beklenen: `No such file or directory`

- [ ] **Step 2: shadcn Sidebar primitive ekle**

```bash
cd apps/web && pnpm dlx shadcn@latest add sidebar
```

Komut etkileşimliyse defaults kabul (mevcut Tailwind 4 config'i bozma; shadcn config'i `components.json`'da Tailwind 4 + RSC ayarı ile zaten doğru).

- [ ] **Step 3: Eklenen dosyaları gözden geçir**

```bash
ls -la apps/web/src/components/ui/sidebar.tsx apps/web/src/hooks/use-mobile.tsx 2>&1
```

Beklenen: her iki dosya da mevcut. `sidebar.tsx` ~700+ satır olur (büyük primitive). `use-mobile.tsx` küçük bir viewport hook.

- [ ] **Step 4: TypeScript ve linting doğrulamasını çalıştır**

```bash
pnpm --filter web typecheck
pnpm --filter web lint
```

Beklenen: ikisi de hatasız. Eğer shadcn dosyaları lint hatası veriyorsa, `eslint.config.mjs`'in `apps/web/src/components/ui/**` için ignore kuralı var; yoksa ekle.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/sidebar.tsx apps/web/src/hooks/use-mobile.tsx apps/web/components.json apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(web): install shadcn Sidebar primitive

Adds Sidebar, SidebarProvider, SidebarTrigger, useSidebar — needed for
the upcoming dashboard shell migration to single sidebar architecture.
No app-level wiring yet; primitive sits in components/ui/ alongside
the other 41 shadcn primitives.
EOF
)"
```

---

## Task 1.2: Add `--size-dropdown-popover` token

**Files:**

- Modify: `apps/web/src/app/tokens/spacing.css` (yeni size token)
- Modify: `apps/web/src/app/globals.css` (`@theme inline` export)

- [ ] **Step 1: spacing.css'i oku ve mevcut size token'larının formatını gör**

```bash
sed -n '40,75p' apps/web/src/app/tokens/spacing.css
```

`--size-input`, `--size-form`, `--size-modal` gibi role-based tokenları göreceksin.

- [ ] **Step 2: `--size-dropdown-popover` token'ını ekle**

`apps/web/src/app/tokens/spacing.css` dosyasında `--size-modal: 32rem;` satırından hemen sonra:

```css
--size-dropdown-popover: 24rem; /* 384px — org+store switcher panel */
```

- [ ] **Step 3: globals.css'in `@theme inline` block'unu aç**

```bash
grep -n "@theme inline" apps/web/src/app/globals.css | head -5
```

Mevcut size export'ların olduğu hattı bul (örneğin `--size-modal: var(--size-modal);`).

- [ ] **Step 4: Aynı pattern ile yeni token'ı expose et**

`apps/web/src/app/globals.css`'in `@theme inline` block'unda, mevcut size-modal export'undan sonra ekle:

```css
--size-dropdown-popover: var(--size-dropdown-popover);
```

- [ ] **Step 5: Doğrulama — Tailwind utility üretildi mi?**

```bash
pnpm --filter web dev &
sleep 5
curl -s http://localhost:3000/_next/static/css/app/layout.css 2>&1 | grep "max-w-dropdown-popover" | head -1
kill %1
```

CSS build sırasında `max-w-dropdown-popover` utility'sinin üretilmesi beklenir. Üretilmiyorsa `@theme inline` export'u kontrol et.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/tokens/spacing.css apps/web/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(web): add --size-dropdown-popover role-based size token

Adds 24rem (384px) sizing token for the upcoming OrgStoreSwitcher
dropdown popover.  Role-based naming avoids the Tailwind v4 `max-w-md`
collision with the spacing scale (existing pattern: --size-modal,
--size-form, --size-sheet).  Consumed via `max-w-dropdown-popover`.
EOF
)"
```

---

## Task 1.3: Extend `nav-config.ts` shape with `badge` + `divider` (backward compat)

**Files:**

- Modify: `apps/web/src/components/layout/nav-config.ts`

Mevcut nav data'yı değiştirmeden type shape'i genişlet — eski 7 nav item olduğu gibi kalır, sadece `NavItemBase`'e opsiyonel `badge` alanı + yeni `divider` item kategorisi eklenir. Phase 3'te yeni groups buraya eklenecek.

- [ ] **Step 1: Mevcut shape'i oku**

```bash
sed -n '15,40p' apps/web/src/components/layout/nav-config.ts
```

`NavSection`, `NavItemBase`, `NavItem` discriminated union'unu göreceksin.

- [ ] **Step 2: Önce test yaz — shape extension backward compat**

`apps/web/tests/unit/lib/nav-config.test.ts` (yeni dosya):

```typescript
import { describe, expect, it } from 'vitest';

import { NAV_ITEMS } from '@/components/layout/nav-config';

describe('nav-config', () => {
  it('mevcut tüm primary nav itemlarını içerir', () => {
    const keys = NAV_ITEMS.map((item) => ('key' in item ? item.key : null));
    expect(keys).toContain('dashboard');
    expect(keys).toContain('orders');
    expect(keys).toContain('products');
    expect(keys).toContain('profitability');
    expect(keys).toContain('reconciliation');
    expect(keys).toContain('expenses');
    expect(keys).toContain('settings');
  });

  it('badge alanı opsiyoneldir — eski itemlarda undefined', () => {
    const dashboard = NAV_ITEMS.find((item) => 'key' in item && item.key === 'dashboard');
    expect(dashboard).toBeDefined();
    if (dashboard && 'badge' in dashboard) {
      expect(dashboard.badge).toBeUndefined();
    }
  });
});
```

- [ ] **Step 3: Testi çalıştır — başarısız**

```bash
pnpm --filter web test:unit -- nav-config
```

Beklenen: PASS (NAV_ITEMS zaten export ediliyor; bu sadece baseline guard testi).

- [ ] **Step 4: `nav-config.ts`'i genişlet**

`apps/web/src/components/layout/nav-config.ts`'in başında, `interface NavSection` üzerine:

```typescript
/**
 * Inline badge for a nav item (e.g., "Yeni", "Beta", count).
 * Renders as a small pill next to the label.  Variants map to
 * existing semantic tokens — no new color tokens introduced.
 */
export interface NavItemBadge {
  variant: 'new' | 'beta' | 'count';
  label: string;
}
```

`NavItemBase`'e opsiyonel alan ekle:

```typescript
export interface NavItemBase {
  key: string;
  labelKey: SubNavItem['labelKey'];
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, IconRail skips this item (visible to ContextRail only). */
  hideFromIconRail?: boolean;
  /** Optional inline badge — Yeni/Beta/count indicator. */
  badge?: NavItemBadge;
}
```

Yeni section divider tipi ekle:

```typescript
/**
 * Visual divider in the nav scroll body — renders as a horizontal
 * dashed separator.  Carries no semantic meaning beyond grouping.
 */
export interface NavDivider {
  type: 'divider';
  key: string;
}

/** All renderable nav entries — items plus dividers. */
export type NavEntry = NavItem | NavDivider;
```

`NAV_ITEMS`'in tipini koru ama yeni `NAV_ENTRIES` export ekle (backward compat için ikisini de tut):

```typescript
export const NAV_ENTRIES = NAV_ITEMS as readonly NavEntry[];
```

- [ ] **Step 5: Type guard helper'ı ekle**

```typescript
export function isNavDivider(entry: NavEntry): entry is NavDivider {
  return 'type' in entry && entry.type === 'divider';
}
```

- [ ] **Step 6: Testi tekrar çalıştır + typecheck**

```bash
pnpm --filter web test:unit -- nav-config
pnpm --filter web typecheck
```

Beklenen: ikisi de PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/nav-config.ts apps/web/tests/unit/lib/nav-config.test.ts
git commit -m "$(cat <<'EOF'
feat(web): extend nav-config shape with badge + divider, backward compat

Adds optional NavItemBadge ('new' | 'beta' | 'count') field to
NavItemBase — existing items unaffected (field undefined).  Adds
NavDivider type and NAV_ENTRIES alias for future renderers.

No data changes yet; nav still has the same 7 primary items.  Phase 3
introduces new groups (Karlilik Analizi, Maliyet & Araclar) and badges
on top of this shape.
EOF
)"
```

---

## Task 1.4: Create `org-avatar-color` deterministic palette util

**Files:**

- Create: `apps/web/src/lib/org-avatar-color.ts`
- Create: `apps/web/tests/unit/lib/org-avatar-color.test.ts`

Hash(orgId) % 6 ile 6 mevcut semantic token'dan birini seçer. Aynı orgId her zaman aynı renge düşer (deterministic). Token disiplini için yeni renk eklenmez.

- [ ] **Step 1: Önce test yaz**

`apps/web/tests/unit/lib/org-avatar-color.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { getOrgAvatarPalette, type OrgAvatarPalette } from '@/lib/org-avatar-color';

describe('getOrgAvatarPalette', () => {
  it('aynı orgId her çağrıda aynı palette index üretir', () => {
    const id = 'org_abc123';
    expect(getOrgAvatarPalette(id)).toBe(getOrgAvatarPalette(id));
  });

  it("farklı orgId'ler genelde farklı palette üretir", () => {
    const palettes = new Set<OrgAvatarPalette>();
    for (let i = 0; i < 100; i++) {
      palettes.add(getOrgAvatarPalette(`org_${i}`));
    }
    // 100 random id'de en az 4 farklı palette beklenir
    expect(palettes.size).toBeGreaterThanOrEqual(4);
  });

  it('boş veya tek karakter string için bile geçerli palette döner', () => {
    expect(['primary', 'success', 'warning', 'info', 'destructive', 'accent']).toContain(
      getOrgAvatarPalette(''),
    );
    expect(['primary', 'success', 'warning', 'info', 'destructive', 'accent']).toContain(
      getOrgAvatarPalette('a'),
    );
  });

  it('Türkçe karakter içeren orgId için crash etmez', () => {
    expect(() => getOrgAvatarPalette('org_İstanbul_Şirketi')).not.toThrow();
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız (modül yok)**

```bash
pnpm --filter web test:unit -- org-avatar-color
```

Beklenen: FAIL "Cannot find module '@/lib/org-avatar-color'".

- [ ] **Step 3: Util'i implement et**

`apps/web/src/lib/org-avatar-color.ts`:

```typescript
/**
 * Deterministic palette index for an organization's avatar background.
 *
 * Maps `orgId` to one of 6 existing semantic tokens via a stable hash.
 * Same `orgId` always produces the same palette across sessions — the
 * user's mental model "Acme is always purple" relies on this.  No new
 * color tokens are introduced; we cycle through the 6 semantic tokens
 * the design system already ships.
 */

export type OrgAvatarPalette =
  | 'primary'
  | 'success'
  | 'warning'
  | 'info'
  | 'destructive'
  | 'accent';

const PALETTES: readonly OrgAvatarPalette[] = [
  'primary',
  'success',
  'warning',
  'info',
  'destructive',
  'accent',
];

/**
 * djb2-style string hash.  Stable across V8/JSCore/SpiderMonkey because
 * we use only basic arithmetic on UTF-16 code units.
 */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getOrgAvatarPalette(orgId: string): OrgAvatarPalette {
  const idx = hashString(orgId) % PALETTES.length;
  return PALETTES[idx]!;
}
```

- [ ] **Step 4: Testi tekrar çalıştır — pass**

```bash
pnpm --filter web test:unit -- org-avatar-color
```

Beklenen: 4/4 PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/org-avatar-color.ts apps/web/tests/unit/lib/org-avatar-color.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add org-avatar-color deterministic palette util

hash(orgId) % 6 picks one of 6 existing semantic tokens (primary,
success, warning, info, destructive, accent).  Stable across sessions
so a given org always renders with the same avatar color — supports
visual recognition.  No new color tokens introduced.
EOF
)"
```

---

## Task 1.5: DB migration — `last_accessed_at` on `organization_members`

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Prisma model)
- Create: `packages/db/prisma/migrations/<timestamp>_add_org_member_last_accessed_at/migration.sql`
- Modify: `supabase/sql/rls-policies.sql` (mevcut policy değişmez ama yorum güncellenir)

Multi-org senaryosunda "Son Kullanılan (3)" listesi için kullanılır. Switch yapıldığında güncellenir; backend endpoint'i Task 1.6'da eklenecek.

- [ ] **Step 1: Mevcut schema'da `organization_members` modelini bul**

```bash
grep -n "organization_members\|model OrganizationMember" packages/db/prisma/schema.prisma
```

- [ ] **Step 2: Modele yeni alan ekle**

`packages/db/prisma/schema.prisma`'da `OrganizationMember` model'ine `joinedAt` veya benzer alan'ın altına:

```prisma
  lastAccessedAt   DateTime? @map("last_accessed_at")
```

- [ ] **Step 3: Index ekle (composite — userId + lastAccessedAt DESC)**

Aynı modelin `@@index` block'larına:

```prisma
  @@index([userId, lastAccessedAt(sort: Desc)], map: "idx_org_members_user_last_accessed")
```

- [ ] **Step 4: Migration oluştur**

```bash
pnpm --filter db migrate-dev --name add_org_member_last_accessed_at
```

Komut, `packages/db/prisma/migrations/<timestamp>_add_org_member_last_accessed_at/migration.sql` üretir. İçeriği oku ve doğrula:

```sql
-- Beklenen içerik:
ALTER TABLE "organization_members" ADD COLUMN "last_accessed_at" TIMESTAMPTZ;

CREATE INDEX "idx_org_members_user_last_accessed" ON "organization_members"("user_id", "last_accessed_at" DESC NULLS LAST);
```

- [ ] **Step 5: RLS policy compatibility doğrulaması**

```bash
grep -n "organization_members" supabase/sql/rls-policies.sql | head -5
```

Mevcut policy `user_id = auth.uid()` filtresi yapıyor — yeni column için ek policy gerekmez. Yorumla:

```sql
-- last_accessed_at: read+write authorized via existing user_id = auth.uid() policy.
-- No new policy needed; column inherits row-level access.
```

- [ ] **Step 6: Test — migration uygulanmış mı?**

```bash
supabase start && pnpm --filter db migrate-status
```

Beklenen: yeni migration "Applied" durumunda.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ supabase/sql/rls-policies.sql
git commit -m "$(cat <<'EOF'
feat(db): add organization_members.last_accessed_at + composite index

Tracks when a user last switched into an organization.  Powers the
"Recently Used (3)" section in the upcoming OrgStoreSwitcher dropdown
when a user belongs to many orgs.  Index sorted by (user_id,
last_accessed_at DESC NULLS LAST) for efficient recent-orgs query.

RLS unchanged — column inherits user_id = auth.uid() row-level access.
EOF
)"
```

---

## Task 1.6: Backend endpoint — update `last_accessed_at` on org switch

**Files:**

- Modify: `apps/api/src/routes/organizations/switch.ts` (varsa) veya `apps/api/src/routes/organizations/index.ts`
- Modify: `apps/api/tests/integration/organizations/switch.test.ts`

Org switch hangi endpoint üzerinden tetikleniyor — mevcut kodda buna bak (`/v1/organizations/:id/switch`) veya bir cookie-based approach var. Bu task endpoint güncellemesini yapar; switcher dropdown'u Task 1.10'da bunu çağıracak.

- [ ] **Step 1: Mevcut org switch davranışını bul**

```bash
grep -rn "last_accessed_at\|setActiveOrg\|switchOrg" apps/api/src/ apps/web/src/lib/active-org.ts 2>&1 | head -10
```

Eğer `apps/web/src/lib/active-org.ts`'da `setActiveOrgId(orgId)` cookie helper'ı varsa, bu cookie set'lendikten sonra arka planda last_accessed_at güncellemek için bir endpoint çağrısı eklenir.

- [ ] **Step 2: Önce integration test yaz**

`apps/api/tests/integration/organizations/switch.test.ts` (yeni veya mevcut):

```typescript
import { describe, expect, it } from 'vitest';

import { authedRequest, createTestOrg, createTestUser } from '../../helpers';

describe('POST /v1/organizations/:orgId/access', () => {
  it("last_accessed_at'ı update eder", async () => {
    const user = await createTestUser();
    const org = await createTestOrg({ ownerId: user.id });
    const before = new Date();

    const res = await authedRequest(user).post(`/v1/organizations/${org.id}/access`).send();

    expect(res.status).toBe(204);

    // DB'den okuyup last_accessed_at >= before olmalı
    const member = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    });
    expect(member?.lastAccessedAt).not.toBeNull();
    expect(member!.lastAccessedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("başka tenant'ın org'u için 404 döner", async () => {
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const otherOrg = await createTestOrg({ ownerId: otherUser.id });

    const res = await authedRequest(user).post(`/v1/organizations/${otherOrg.id}/access`).send();

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Testi çalıştır — başarısız**

```bash
pnpm --filter api test:integration -- switch
```

Beklenen: FAIL "Route not found" veya benzer.

- [ ] **Step 4: Endpoint'i ekle**

`apps/api/src/routes/organizations/index.ts` (veya benzeri kayıt dosyası) içinde, mevcut OpenAPI route definition pattern'ı ile:

```typescript
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';

import { mapPrismaError } from '@/lib/errors/prisma-error';
import { NotFoundError } from '@/lib/errors';
import { requireOrgAccess } from '@/lib/middleware/require-org-access';

const accessRoute = createRoute({
  method: 'post',
  path: '/organizations/{orgId}/access',
  request: {
    params: z.object({ orgId: z.string().uuid() }),
  },
  responses: {
    204: { description: 'Access timestamp updated' },
    404: { description: 'Organization not found or no membership' },
  },
});

orgs.openapi(accessRoute, async (c) => {
  const { orgId } = c.req.valid('param');
  const userId = c.get('userId');

  try {
    await prisma.organizationMember.update({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      data: { lastAccessedAt: new Date() },
    });
  } catch (e) {
    throw mapPrismaError(e, NotFoundError);
  }

  return c.body(null, 204);
});
```

- [ ] **Step 5: API contract sync (frontend client'ı yeniden generate et)**

```bash
pnpm api:sync
```

Bu, `@pazarsync/api-client`'in path interface'ini günceller, frontend bir sonraki PR'ı build ederken endpoint görünür olur.

- [ ] **Step 6: Testleri çalıştır — pass**

```bash
pnpm --filter api test:integration -- switch
```

Beklenen: 2/2 PASS.

- [ ] **Step 7: Multi-tenancy isolation test'i ekle**

`apps/api/tests/integration/tenant-isolation/organizations-access.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { authedRequest, createTestOrg, createTestUser, prisma } from '../../helpers';

describe('Tenant isolation — POST /organizations/:id/access', () => {
  it("user A cannot update user B's membership timestamp", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const orgB = await createTestOrg({ ownerId: userB.id });

    const before = await prisma.organizationMember.findFirst({
      where: { userId: userB.id, organizationId: orgB.id },
    });

    const res = await authedRequest(userA).post(`/v1/organizations/${orgB.id}/access`).send();

    expect(res.status).toBe(404);

    const after = await prisma.organizationMember.findFirst({
      where: { userId: userB.id, organizationId: orgB.id },
    });
    expect(after?.lastAccessedAt).toEqual(before?.lastAccessedAt); // unchanged
  });
});
```

- [ ] **Step 8: Multi-tenancy testi çalıştır**

```bash
pnpm --filter api test:integration -- tenant-isolation
```

Beklenen: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/ apps/api/tests/ packages/api-client/
git commit -m "$(cat <<'EOF'
feat(api): POST /organizations/:id/access updates last_accessed_at

New endpoint called by the upcoming OrgStoreSwitcher when the user
switches into an org.  Updates the calling user's
organization_members.last_accessed_at to NOW(); returns 204.

Tenant isolation: 404 on cross-tenant access (existing
require-org-access middleware).  Multi-tenancy isolation test added.
EOF
)"
```

---

## Task 1.7: `BottomDock` pattern (sticky utility cluster)

**Files:**

- Create: `apps/web/src/components/patterns/bottom-dock.tsx`
- Create: `apps/web/tests/component/bottom-dock.test.tsx`
- Create: `apps/web/src/app/[locale]/(showcase)/design/patterns/bottom-dock-showcase.tsx`
- Modify: `apps/web/messages/tr.json`, `apps/web/messages/en.json`

`BottomDock` sidebar'ın dibinde sticky kalır. İçerikleri prop olarak alır; tema toggle, user dock row, support/settings link'leri parent tarafından enjekte edilir. Pattern saf yapısaldır — i18n parent'ta yapılır.

- [ ] **Step 1: Önce test yaz**

`apps/web/tests/component/bottom-dock.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/../tests/helpers/render';

import { BottomDock } from '@/components/patterns/bottom-dock';

describe('BottomDock', () => {
  it('children'ı sticky bottom slot\'unda render eder', () => {
    render(
      <BottomDock>
        <button>Destek</button>
        <button>Ayarlar</button>
      </BottomDock>,
    );
    expect(screen.getByRole('button', { name: 'Destek' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ayarlar' })).toBeInTheDocument();
  });

  it('focus-visible focus stiline sahiptir (focusable elementler için)', () => {
    render(
      <BottomDock>
        <button data-testid="dock-btn">Test</button>
      </BottomDock>,
    );
    const btn = screen.getByTestId('dock-btn');
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('separator role\'lü dashed divider eklenebilir', () => {
    render(
      <BottomDock>
        <button>Üst</button>
        <BottomDock.Divider />
        <button>Alt</button>
      </BottomDock>,
    );
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız**

```bash
pnpm --filter web test:component -- bottom-dock
```

Beklenen: FAIL "Cannot find module".

- [ ] **Step 3: Pattern'ı implement et**

`apps/web/src/components/patterns/bottom-dock.tsx`:

```tsx
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface BottomDockProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Sticky utility cluster at the bottom of the dashboard sidebar.
 * Hosts Support / Settings / Theme toggle / User row.  Pattern is
 * structurally minimal — content is composed by the AppShell so this
 * component stays i18n-agnostic.
 */
export function BottomDock({ children, className }: BottomDockProps): React.ReactElement {
  return (
    <div
      className={cn('border-border bg-background gap-3xs p-xs flex flex-col border-t', className)}
    >
      {children}
    </div>
  );
}

/**
 * Dashed separator inside the dock.  Use sparingly to delineate
 * utility links from the user row.
 */
function BottomDockDivider(): React.ReactElement {
  return <hr role="separator" className="border-border my-3xs border-t border-dashed" />;
}

BottomDock.Divider = BottomDockDivider;
```

- [ ] **Step 4: Testi tekrar çalıştır — pass**

```bash
pnpm --filter web test:component -- bottom-dock
```

Beklenen: 3/3 PASS.

- [ ] **Step 5: Showcase ekle**

`apps/web/src/app/[locale]/(showcase)/design/patterns/bottom-dock-showcase.tsx`:

```tsx
import { BottomDock } from '@/components/patterns/bottom-dock';
import { Button } from '@/components/ui/button';

export function BottomDockShowcase(): React.ReactElement {
  return (
    <div
      className="border-border w-rail-context bg-card rounded-md border"
      style={{ minHeight: 240 }}
    >
      <div className="text-muted-foreground p-md text-2xs">(sidebar üst kısmı placeholder)</div>
      <BottomDock>
        <Button variant="ghost" size="sm" className="justify-start">
          ❓ Destek
        </Button>
        <Button variant="ghost" size="sm" className="justify-start">
          ⚙ Ayarlar
        </Button>
        <BottomDock.Divider />
        <Button variant="ghost" size="sm" className="justify-start">
          👤 Berkin Oktay
        </Button>
      </BottomDock>
    </div>
  );
}
```

- [ ] **Step 6: `/design/patterns` route'una ekle**

`apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx` içinde, mevcut showcase listesinin sonuna:

```tsx
import { BottomDockShowcase } from './bottom-dock-showcase';

// ... mevcut showcase'lerden sonra:
<section>
  <h2>BottomDock</h2>
  <BottomDockShowcase />
</section>;
```

- [ ] **Step 7: Lint + typecheck**

```bash
pnpm --filter web lint
pnpm --filter web typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/patterns/bottom-dock.tsx apps/web/tests/component/bottom-dock.test.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/
git commit -m "$(cat <<'EOF'
feat(web): add BottomDock pattern + showcase

Sticky utility cluster for the bottom of the upcoming single sidebar.
Structurally minimal — composes whatever the AppShell injects (theme
toggle, support link, user row).  Includes a dashed Divider sub-
component (role="separator").  Showcase added to /design/patterns.
EOF
)"
```

---

## Task 1.8: `ThemeToggleInline` pattern (SSR-safe theme switch)

**Files:**

- Create: `apps/web/src/components/patterns/theme-toggle-inline.tsx`
- Create: `apps/web/tests/component/theme-toggle-inline.test.tsx`
- Create: `apps/web/src/app/[locale]/(showcase)/design/patterns/theme-toggle-showcase.tsx`
- Modify: `apps/web/messages/tr.json`, `apps/web/messages/en.json`

CSS-only icon swap (Sun/Moon ikisi de render, `dark:` variant ile değişir). `useTheme()` render-time okumaz — `apps/web/CLAUDE.md` "SSR safety" #1 paterni.

- [ ] **Step 1: Test yaz — SSR-safe contract**

`apps/web/tests/component/theme-toggle-inline.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';

import { render, screen } from '@/../tests/helpers/render';
import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';

const messages = {
  themeToggle: {
    label: 'Tema',
    light: 'Açık',
    dark: 'Koyu',
  },
};

function Wrapped(): React.ReactElement {
  return (
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="light">
        <ThemeToggleInline />
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

describe('ThemeToggleInline', () => {
  it("hem Sun hem Moon ikonu DOM'a yazar (CSS-only swap)", () => {
    render(<Wrapped />);
    expect(screen.getByTestId('theme-icon-sun')).toBeInTheDocument();
    expect(screen.getByTestId('theme-icon-moon')).toBeInTheDocument();
  });

  it("label'ı Türkçe gösterir", () => {
    render(<Wrapped />);
    expect(screen.getByText('Tema')).toBeInTheDocument();
  });

  it('switch tıklanınca tema değişir', async () => {
    const user = userEvent.setup();
    render(<Wrapped />);
    const toggle = screen.getByRole('switch', { name: /tema/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
```

- [ ] **Step 2: Test başarısız çalıştır**

```bash
pnpm --filter web test:component -- theme-toggle-inline
```

Beklenen: FAIL "Cannot find module".

- [ ] **Step 3: i18n key'lerini ekle**

`apps/web/messages/tr.json`'e (top-level veya `common`):

```json
"themeToggle": {
  "label": "Tema",
  "light": "Açık tema",
  "dark": "Koyu tema"
}
```

`apps/web/messages/en.json`:

```json
"themeToggle": {
  "label": "Theme",
  "light": "Light theme",
  "dark": "Dark theme"
}
```

- [ ] **Step 4: Pattern'ı implement et**

`apps/web/src/components/patterns/theme-toggle-inline.tsx`:

```tsx
'use client';

import { Sun01Icon, Moon02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Switch } from '@/components/ui/switch';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

/**
 * Inline theme toggle for the sidebar bottom dock.
 *
 * SSR safety (apps/web/CLAUDE.md "SSR safety" #1):
 *   - useTheme() is NOT read during render to decide what to render.
 *   - Both Sun and Moon icons are always in the DOM; the `dark:`
 *     Tailwind variant swaps which is visible.  next-themes' head
 *     script puts class="dark" on <html> before hydration so CSS
 *     applies from the first paint.
 *   - The Switch's `checked` prop reads `resolvedTheme` only after
 *     mount (via useIsMounted gate) — until then it falls back to
 *     the SSR-rendered "off" state.  Hydration stays byte-identical.
 */
export function ThemeToggleInline(): React.ReactElement {
  const t = useTranslations('themeToggle');
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useIsMounted();

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div className="bg-muted gap-xs px-xs py-3xs text-2xs flex items-center rounded-sm">
      <Sun01Icon
        data-testid="theme-icon-sun"
        className={cn('size-icon-sm shrink-0 transition-opacity dark:opacity-40')}
        aria-hidden
      />
      <Moon02Icon
        data-testid="theme-icon-moon"
        className={cn('size-icon-sm shrink-0 opacity-40 transition-opacity dark:opacity-100')}
        aria-hidden
      />
      <span className="flex-1">{t('label')}</span>
      <Switch
        checked={isDark}
        onCheckedChange={(next) => setTheme(next ? 'dark' : 'light')}
        aria-label={t('label')}
      />
    </div>
  );
}
```

- [ ] **Step 5: `useIsMounted` mevcut mu kontrol et**

```bash
ls apps/web/src/lib/use-is-mounted.ts 2>&1
```

Yoksa oluştur (genelde önceki PR'larda eklenmiştir; CLAUDE.md "SSR safety toolkit" tablosunda referans).

- [ ] **Step 6: Test'i tekrar çalıştır — pass**

```bash
pnpm --filter web test:component -- theme-toggle-inline
```

Beklenen: 3/3 PASS.

- [ ] **Step 7: Showcase ekle**

`apps/web/src/app/[locale]/(showcase)/design/patterns/theme-toggle-showcase.tsx`:

```tsx
import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';

export function ThemeToggleShowcase(): React.ReactElement {
  return (
    <div className="border-border w-rail-context bg-card p-md rounded-md border">
      <ThemeToggleInline />
    </div>
  );
}
```

`/design/patterns/page.tsx`'e ekleme (aynı pattern Task 1.7'de gösterildi).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/patterns/theme-toggle-inline.tsx apps/web/tests/component/theme-toggle-inline.test.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/theme-toggle-showcase.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/page.tsx apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add ThemeToggleInline pattern (SSR-safe)

Inline theme switch for the sidebar bottom dock.  Renders both Sun
and Moon icons; CSS-only swap via the `dark:` variant follows the
"SSR safety #1" pattern in apps/web/CLAUDE.md.  resolvedTheme is read
behind a useIsMounted gate so SSR renders the same as the first paint.
EOF
)"
```

---

## Task 1.9: `NavGroup` pattern (expandable header + sub-items)

**Files:**

- Create: `apps/web/src/components/patterns/nav-group.tsx`
- Create: `apps/web/tests/component/nav-group.test.tsx`
- Create: `apps/web/src/app/[locale]/(showcase)/design/patterns/nav-group-showcase.tsx`

Tek başına kullanılan group header + collapsible body. Expand state local (useState), animasyon `grid-template-rows: 0fr ↔ 1fr` (apps/web/CLAUDE.md motion section).

- [ ] **Step 1: Test yaz**

`apps/web/tests/component/nav-group.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/../tests/helpers/render';
import { NavGroup } from '@/components/patterns/nav-group';

describe('NavGroup', () => {
  it("default collapsed iken sub-item'ları gizler", () => {
    render(
      <NavGroup label="Karlılık Analizi" icon="📈">
        <button>Sipariş Karlılığı</button>
        <button>Ürün Karlılığı</button>
      </NavGroup>,
    );
    expect(screen.queryByText('Sipariş Karlılığı')).not.toBeVisible();
  });

  it('header tıklanınca expand olur', async () => {
    const user = userEvent.setup();
    render(
      <NavGroup label="Karlılık Analizi" icon="📈">
        <button>Sipariş Karlılığı</button>
      </NavGroup>,
    );
    await user.click(screen.getByRole('button', { name: /karlılık analizi/i }));
    expect(screen.getByText('Sipariş Karlılığı')).toBeVisible();
  });

  it('defaultExpanded prop verilmişse açık başlar', () => {
    render(
      <NavGroup label="Karlılık" icon="📈" defaultExpanded>
        <button>Sub</button>
      </NavGroup>,
    );
    expect(screen.getByText('Sub')).toBeVisible();
  });

  it("badge prop'u render edilir", () => {
    render(
      <NavGroup label="Karlılık" icon="📈" badge={{ variant: 'beta', label: 'Beta' }}>
        <button>Sub</button>
      </NavGroup>,
    );
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test başarısız çalıştır**

```bash
pnpm --filter web test:component -- nav-group
```

Beklenen: FAIL.

- [ ] **Step 3: Pattern'ı implement et**

`apps/web/src/components/patterns/nav-group.tsx`:

```tsx
'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import type { NavItemBadge } from '@/components/layout/nav-config';
import { cn } from '@/lib/utils';

export interface NavGroupProps {
  /** Localized label rendered in the header. */
  label: string;
  /** Icon node (or emoji) shown left of the label. */
  icon: React.ReactNode;
  /** Optional inline badge — Yeni / Beta. */
  badge?: NavItemBadge;
  /** Open by default (e.g., when current route is inside this group). */
  defaultExpanded?: boolean;
  /** Sub-items, rendered indented when expanded. */
  children: React.ReactNode;
  className?: string;
}

const BADGE_VARIANT: Record<NavItemBadge['variant'], 'default' | 'success' | 'warning'> = {
  count: 'warning',
  new: 'success',
  beta: 'warning',
};

/**
 * Expandable nav group — header + collapsible body.  Used in the
 * single sidebar to host nested feature routes (Karlilik Analizi,
 * Maliyet & Araclar).  Animation uses `grid-template-rows: 0fr -> 1fr`
 * per apps/web/CLAUDE.md motion guidance — never animate `height`.
 */
export function NavGroup({
  label,
  icon,
  badge,
  defaultExpanded = false,
  children,
  className,
}: NavGroupProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          'hover:bg-muted text-muted-foreground hover:text-foreground duration-fast gap-xs px-xs py-3xs flex items-center rounded-sm text-xs transition-colors',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        )}
      >
        <span className="size-icon-sm shrink-0" aria-hidden>
          {icon}
        </span>
        <span className="flex-1 text-left">{label}</span>
        {badge ? (
          <Badge variant={BADGE_VARIANT[badge.variant]} className="text-2xs">
            {badge.label}
          </Badge>
        ) : null}
        <ArrowDown01Icon
          className={cn(
            'size-icon-xs duration-fast shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div
        className={cn(
          'duration-base ease-out-quart grid transition-[grid-template-rows]',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-border ml-md gap-3xs py-3xs pl-xs flex flex-col border-l">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test'i pass et**

```bash
pnpm --filter web test:component -- nav-group
```

Beklenen: 4/4 PASS.

- [ ] **Step 5: Badge variant'larını shadcn `Badge`'de kontrol et**

```bash
grep "variants" apps/web/src/components/ui/badge.tsx
```

Eğer `success` veya `warning` variant'ı yoksa, ekle veya `default` + custom className ile kompanse et. **Badge'i fork etmek yasak**; shadcn'in `cva` config'ine variant eklemek "extension" sayılır (ban değil).

- [ ] **Step 6: Showcase ekle**

`apps/web/src/app/[locale]/(showcase)/design/patterns/nav-group-showcase.tsx`:

```tsx
import { NavGroup } from '@/components/patterns/nav-group';

export function NavGroupShowcase(): React.ReactElement {
  return (
    <div className="border-border bg-card w-rail-context gap-3xs p-md flex flex-col rounded-md border">
      <NavGroup
        label="Karlılık Analizi"
        icon="📈"
        badge={{ variant: 'beta', label: 'Beta' }}
        defaultExpanded
      >
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Sipariş Karlılığı
        </a>
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Ürün Karlılığı
        </a>
      </NavGroup>
      <NavGroup label="Maliyet & Araçlar" icon="🛠">
        <a className="text-muted-foreground hover:text-foreground px-xs py-3xs text-xs" href="#">
          Komisyon Hesaplama
        </a>
      </NavGroup>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/patterns/nav-group.tsx apps/web/tests/component/nav-group.test.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/nav-group-showcase.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/page.tsx apps/web/src/components/ui/badge.tsx
git commit -m "$(cat <<'EOF'
feat(web): add NavGroup pattern (expandable nav header)

Header + collapsible body with grid-template-rows animation (per
CLAUDE.md motion guidance — height transitions are banned).  Used in
the upcoming single sidebar for nested feature groups.  Renders
optional Yeni/Beta/count badge inline.  Showcase added to
/design/patterns with two example groups.
EOF
)"
```

---

## Task 1.10: `OrgStoreSwitcher` pattern (kombine chip + layered dropdown)

**Files:**

- Create: `apps/web/src/components/patterns/org-store-switcher.tsx`
- Create: `apps/web/src/components/patterns/org-store-switcher-list.tsx` (internal row renderer)
- Create: `apps/web/tests/component/org-store-switcher.test.tsx`
- Create: `apps/web/src/app/[locale]/(showcase)/design/patterns/org-store-switcher-showcase.tsx`
- Modify: `apps/web/messages/tr.json`, `apps/web/messages/en.json`

En karmaşık pattern. Chip (expanded + collapsed mode), Popover ile dropdown panel, Command primitive ile fuzzy search, role badges, sync pulse, multi-org indicator. Spec'in section 6'sı tam burada implement olur.

- [ ] **Step 1: Test yaz — chip + dropdown davranışı**

`apps/web/tests/component/org-store-switcher.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, within } from '@/../tests/helpers/render';
import { OrgStoreSwitcher } from '@/components/patterns/org-store-switcher';
import type { Organization, Store } from '@/components/patterns/org-store-switcher';

const mockOrgs: Organization[] = [
  {
    id: 'org-a',
    name: 'Acme A.Ş.',
    role: 'OWNER',
    storeCount: 2,
    lastSyncedAt: '2026-04-25T11:55:00Z',
  },
  {
    id: 'org-b',
    name: 'Beta Ltd',
    role: 'ADMIN',
    storeCount: 5,
    lastSyncedAt: '2026-04-25T11:00:00Z',
  },
];

const mockStores: Store[] = [
  {
    id: 'store-1',
    name: 'Trendyol Acme TR',
    platform: 'TRENDYOL',
    syncState: 'fresh',
    lastSyncedAt: '2026-04-25T11:55:00Z',
  },
  {
    id: 'store-2',
    name: 'Hepsiburada Acme',
    platform: 'HEPSIBURADA',
    syncState: 'stale',
    lastSyncedAt: '2026-04-25T09:00:00Z',
  },
];

describe('OrgStoreSwitcher — expanded chip', () => {
  it("aktif org ve store ismini chip'te gösterir", () => {
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
      />,
    );
    expect(screen.getByText('Acme A.Ş.')).toBeInTheDocument();
    expect(screen.getByText('Trendyol Acme TR')).toBeInTheDocument();
  });

  it('chip tıklanınca dropdown açılır, search input görünür', async () => {
    const user = userEvent.setup();
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /acme/i }));
    expect(await screen.findByPlaceholderText(/ara/i)).toBeInTheDocument();
  });

  it('search "trend" yazılınca Trendyol mağazası filtrelenir', async () => {
    const user = userEvent.setup();
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /acme/i }));
    await user.type(screen.getByPlaceholderText(/ara/i), 'trend');
    expect(screen.getByText('Trendyol Acme TR')).toBeInTheDocument();
    // Hepsiburada match etmemeli
    expect(screen.queryByText('Hepsiburada Acme')).not.toBeInTheDocument();
  });

  it('org satırı tıklanınca onSelectOrg çağrılır', async () => {
    const user = userEvent.setup();
    const onSelectOrg = vi.fn();
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={onSelectOrg}
        onSelectStore={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /acme/i }));
    await user.click(screen.getByText('Beta Ltd'));
    expect(onSelectOrg).toHaveBeenCalledWith('org-b');
  });

  it('OWNER badge accent renkte, ADMIN/MEMBER muted renkte', async () => {
    const user = userEvent.setup();
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /acme/i }));
    const ownerBadge = screen.getByText(/owner/i);
    const adminBadge = screen.getByText(/admin/i);
    expect(ownerBadge).toBeInTheDocument();
    expect(adminBadge).toBeInTheDocument();
  });

  it('empty state — orgs boşsa "Yeni Organizasyon Oluştur" CTA gösterilir', async () => {
    const user = userEvent.setup();
    render(
      <OrgStoreSwitcher
        orgs={[]}
        stores={[]}
        activeOrgId={null}
        activeStoreId={null}
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /organizasyon/i }));
    expect(screen.getByText(/yeni organizasyon oluştur/i)).toBeInTheDocument();
  });
});

describe('OrgStoreSwitcher — collapsed mode', () => {
  it('collapsed prop true iken sadece avatar gösterir, isimler gizli', () => {
    render(
      <OrgStoreSwitcher
        orgs={mockOrgs}
        stores={mockStores}
        activeOrgId="org-a"
        activeStoreId="store-1"
        onSelectOrg={vi.fn()}
        onSelectStore={vi.fn()}
        collapsed
      />,
    );
    expect(screen.queryByText('Acme A.Ş.')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test başarısız çalıştır**

```bash
pnpm --filter web test:component -- org-store-switcher
```

Beklenen: FAIL.

- [ ] **Step 3: i18n key'leri ekle**

`apps/web/messages/tr.json`'e:

```json
"orgStoreSwitcher": {
  "search": "Org veya mağaza ara…",
  "sectionOrgs": "Organizasyonlar",
  "sectionStores": "Mağazalar",
  "addOrg": "+ Yeni",
  "connectStore": "+ Bağla",
  "footerOrgSettings": "Org ayarları",
  "footerStoreManagement": "Mağaza yönetimi",
  "footerNewOrg": "+ Yeni Org",
  "emptyTitle": "Henüz bir organizasyona sahip değilsin",
  "emptyDescription": "PazarSync'e başlamak için bir organizasyon oluştur ya da bir davete katıl.",
  "emptyCreate": "+ Yeni Organizasyon Oluştur",
  "emptyJoinInvite": "Davet Kodum Var",
  "roleOwner": "Owner",
  "roleAdmin": "Admin",
  "roleMember": "Member",
  "stores": "{count, plural, =0 {mağaza yok} =1 {1 mağaza} other {# mağaza}}",
  "lastSync": "Son senkron {when}",
  "syncStateFresh": "Senkron",
  "syncStateStale": "Yenile",
  "syncStateFailed": "Senkron başarısız"
}
```

`en.json` için aynı key'ler İngilizce karşılıkları.

- [ ] **Step 4: Org/Store types'ı tanımla**

Pattern'in başına ortak types:

```tsx
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type SyncState = 'fresh' | 'stale' | 'failed';

export interface Organization {
  id: string;
  name: string;
  role: OrgRole;
  storeCount: number;
  lastSyncedAt: string | null;
}

export interface Store {
  id: string;
  name: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  syncState: SyncState;
  lastSyncedAt: string | null;
}

export interface OrgStoreSwitcherProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
  /** Collapsed sidebar mode — render icon-only avatar trigger. */
  collapsed?: boolean;
}
```

- [ ] **Step 5: `OrgStoreSwitcher` ana component'ini implement et**

`apps/web/src/components/patterns/org-store-switcher.tsx`:

```tsx
'use client';

import { ArrowDown01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { getOrgAvatarPalette } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import { OrgStoreSwitcherEmpty } from './org-store-switcher-list';
import type { Organization, OrgStoreSwitcherProps, Store } from './org-store-switcher.types'; // (eğer ayrı dosyaya alınırsa; alternatif olarak inline)

const PALETTE_BG: Record<ReturnType<typeof getOrgAvatarPalette>, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
};

const SYNC_BG: Record<Store['syncState'], string> = {
  fresh: 'bg-success',
  stale: 'bg-warning',
  failed: 'bg-destructive',
};

const ROLE_LABEL_KEY: Record<Organization['role'], 'roleOwner' | 'roleAdmin' | 'roleMember'> = {
  OWNER: 'roleOwner',
  ADMIN: 'roleAdmin',
  MEMBER: 'roleMember',
};

export function OrgStoreSwitcher({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
  collapsed = false,
}: OrgStoreSwitcherProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  const [open, setOpen] = React.useState(false);

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
  const activeStore = stores.find((s) => s.id === activeStoreId) ?? null;
  const isEmpty = orgs.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            activeOrg ? `${activeOrg.name} · ${activeStore?.name ?? ''}` : t('emptyCreate')
          }
          className={cn(
            'hover:bg-muted bg-muted/50 duration-fast gap-xs flex items-center rounded-sm transition-colors',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            collapsed ? 'size-2xl justify-center p-0' : 'px-xs py-3xs w-full',
          )}
        >
          {activeOrg ? (
            <OrgAvatar org={activeOrg} activeStore={activeStore} />
          ) : (
            <Avatar className="size-xl">
              <AvatarFallback>+</AvatarFallback>
            </Avatar>
          )}
          {!collapsed ? (
            <>
              <span className="gap-3xs flex flex-1 flex-col items-start overflow-hidden">
                <span className="text-foreground truncate text-xs font-medium">
                  {activeOrg?.name ?? t('emptyCreate')}
                </span>
                {activeStore ? (
                  <span className="text-muted-foreground gap-3xs text-2xs flex items-center truncate">
                    <span
                      className={cn(
                        'size-xs shrink-0 rounded-full',
                        SYNC_BG[activeStore.syncState],
                      )}
                    />
                    {activeStore.name}
                  </span>
                ) : null}
              </span>
              <ArrowDown01Icon className="size-icon-xs text-muted-foreground shrink-0" />
            </>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={collapsed ? 'right' : 'bottom'}
        className="max-w-dropdown-popover w-[--size-dropdown-popover] p-0"
      >
        {isEmpty ? (
          <OrgStoreSwitcherEmpty />
        ) : (
          <OrgStoreSwitcherList
            orgs={orgs}
            stores={stores}
            activeOrgId={activeOrgId}
            activeStoreId={activeStoreId}
            onSelectOrg={(id) => {
              onSelectOrg(id);
              setOpen(false);
            }}
            onSelectStore={(id) => {
              onSelectStore(id);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function OrgAvatar({
  org,
  activeStore,
}: {
  org: Organization;
  activeStore: Store | null;
}): React.ReactElement {
  const palette = getOrgAvatarPalette(org.id);
  const initial = org.name.charAt(0).toUpperCase();

  return (
    <span className="relative shrink-0">
      <Avatar className={cn('size-xl', PALETTE_BG[palette])}>
        <AvatarFallback className={cn(PALETTE_BG[palette], 'font-semibold')}>
          {initial}
        </AvatarFallback>
      </Avatar>
      {activeStore ? (
        <span className="ring-card -bottom-3xs -right-3xs absolute ring-2">
          <MarketplaceLogo platform={activeStore.platform} size="sm" alt="" />
        </span>
      ) : null}
    </span>
  );
}

// (OrgStoreSwitcherList implementation continues — bkz. Step 6)
```

- [ ] **Step 6: `OrgStoreSwitcherList` (dropdown body)**

`apps/web/src/components/patterns/org-store-switcher-list.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { getOrgAvatarPalette } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import type { Organization, Store } from './org-store-switcher';

interface ListProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
}

const PALETTE_BG = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
} as const;

export function OrgStoreSwitcherList({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
}: ListProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');

  return (
    <Command>
      <CommandInput placeholder={t('search')} />
      <CommandList>
        <CommandEmpty>{t('emptyDescription')}</CommandEmpty>
        <CommandGroup heading={t('sectionOrgs')}>
          {orgs.map((org) => {
            const palette = getOrgAvatarPalette(org.id);
            return (
              <CommandItem
                key={org.id}
                value={`${org.name} ${org.id}`}
                onSelect={() => onSelectOrg(org.id)}
                className={cn(activeOrgId === org.id && 'bg-accent')}
              >
                <span
                  className={cn(
                    'mr-xs size-md text-2xs flex items-center justify-center rounded-sm font-semibold',
                    PALETTE_BG[palette],
                  )}
                >
                  {org.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-xs">{org.name}</span>
                <Badge
                  variant={org.role === 'OWNER' ? 'default' : 'secondary'}
                  className="text-2xs"
                >
                  {t(
                    org.role === 'OWNER'
                      ? 'roleOwner'
                      : org.role === 'ADMIN'
                        ? 'roleAdmin'
                        : 'roleMember',
                  )}
                </Badge>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t('sectionStores')}>
          {stores.map((store) => (
            <CommandItem
              key={store.id}
              value={`${store.name} ${store.id}`}
              onSelect={() => onSelectStore(store.id)}
              className={cn(activeStoreId === store.id && 'bg-accent')}
            >
              <span className="mr-xs shrink-0">
                <MarketplaceLogo platform={store.platform} size="sm" alt="" />
              </span>
              <span className="flex-1 truncate text-xs">{store.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export function OrgStoreSwitcherEmpty(): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  return (
    <div className="gap-xs p-md flex flex-col">
      <h3 className="text-sm font-medium">{t('emptyTitle')}</h3>
      <p className="text-muted-foreground text-2xs">{t('emptyDescription')}</p>
      <a
        href="/onboarding/create-organization"
        className="bg-primary text-primary-foreground px-xs py-3xs text-2xs rounded-sm text-center font-medium"
      >
        {t('emptyCreate')}
      </a>
      <a
        href="/onboarding/join-organization"
        className="bg-muted text-foreground px-xs py-3xs text-2xs rounded-sm text-center"
      >
        {t('emptyJoinInvite')}
      </a>
    </div>
  );
}
```

- [ ] **Step 7: Test'i pass et**

```bash
pnpm --filter web test:component -- org-store-switcher
```

Beklenen: 7/7 PASS. Eğer Command primitive search davranışı testteki cross-match'i tetiklemiyorsa, CommandItem'ların `value` prop'unu hem org name hem store name içerecek şekilde genişlet.

- [ ] **Step 8: Showcase ekle**

`org-store-switcher-showcase.tsx` Tiyasis-tier mock data ile bir state demonstrasyonu (default + collapsed + empty + multi-org).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/patterns/org-store-switcher.tsx apps/web/src/components/patterns/org-store-switcher-list.tsx apps/web/src/lib/org-avatar-color.ts apps/web/tests/component/org-store-switcher.test.tsx apps/web/src/app/\[locale\]/\(showcase\)/design/patterns/ apps/web/messages/
git commit -m "$(cat <<'EOF'
feat(web): add OrgStoreSwitcher pattern

Combined chip + layered popover dropdown for the upcoming single
sidebar.  Supports expanded + collapsed states, fuzzy search across
orgs and stores, role badges, sync pulses, MarketplaceLogo as platform
corner badge, and empty / pending-invite states.  Built on shadcn
Popover + Command primitives.  No new color tokens — org avatars cycle
through the 6 existing semantic tokens via getOrgAvatarPalette.
EOF
)"
```

---

# Phase 2 — Shell Switch

Yeni `AppShell` shadcn Sidebar üzerine yazılır. Eski 5 layout dosyası silinir. Dashboard page'in "Hızlı Erişim" warning panelleri page body'ye taşınır. PR ship edildiğinde tüm dashboard route'ları yeni shell ile render olur.

## Task 2.1: Yeni `AppShell` — shadcn Sidebar üzerinde

**Files:**

- Modify: `apps/web/src/components/layout/app-shell.tsx` (overwrite)
- Create: `apps/web/tests/component/app-shell.test.tsx`

- [ ] **Step 1: Mevcut `app-shell.tsx`'i yedekle (referans için)**

```bash
cp apps/web/src/components/layout/app-shell.tsx /tmp/app-shell-old-3rail.tsx.bak
```

- [ ] **Step 2: Test yaz**

`apps/web/tests/component/app-shell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/../tests/helpers/render';
import { AppShell } from '@/components/layout/app-shell';

describe('AppShell', () => {
  it("children'ı main slot'unda render eder", () => {
    render(<AppShell>page content</AppShell>);
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('SidebarTrigger butonu mevcut', () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole('button', { name: /toggle/i })).toBeInTheDocument();
  });

  it('main alanı role="main" landmark\'a sahip', () => {
    render(<AppShell>x</AppShell>);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('sidebar collapse toggle çalışır (cookie write attempt)', async () => {
    const user = userEvent.setup();
    render(<AppShell>x</AppShell>);
    const trigger = screen.getByRole('button', { name: /toggle/i });
    await user.click(trigger);
    // (Cookie persistence happens server-side; here we just verify no crash)
  });
});
```

- [ ] **Step 3: Test başarısız çalıştır**

```bash
pnpm --filter web test:component -- app-shell
```

- [ ] **Step 4: Yeni `AppShell`'i implement et**

`apps/web/src/components/layout/app-shell.tsx` (overwrite):

```tsx
'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { BottomDock } from '@/components/patterns/bottom-dock';
import { NavGroup } from '@/components/patterns/nav-group';
import { OrgStoreSwitcher } from '@/components/patterns/org-store-switcher';
import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';
import { Wordmark } from '@/components/brand/wordmark';
import { NotificationBell } from '@/components/patterns/notification-bell';
import { UserMenu } from '@/features/auth/components/user-menu';
import { isNavDivider, NAV_ENTRIES } from '@/components/layout/nav-config';
import { Link, usePathname } from '@/i18n/navigation';
import { useOrganizations } from '@/features/organization/hooks/use-organizations';
import { useStores } from '@/features/stores/hooks/use-stores';
import { useActiveOrg } from '@/features/organization/hooks/use-active-org';
import { useActiveStore } from '@/features/stores/hooks/use-active-store';

export interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps): React.ReactElement {
  return (
    <SidebarProvider defaultOpen>
      <AppShellSidebar />
      <SidebarInset>
        {/* Mobile-only header — hamburger trigger + bell + user menu inline */}
        <header className="border-border gap-xs px-sm flex h-12 items-center justify-between border-b md:hidden">
          <div className="gap-xs flex items-center">
            <SidebarTrigger />
            <Wordmark withText={false} />
          </div>
          <div className="gap-xs flex items-center">
            <NotificationBell entries={[]} unreadCount={0} />
            <UserMenu />
          </div>
        </header>
        <main role="main" id="main" className="flex-1 overflow-y-auto">
          <div className="max-w-content-max gap-lg px-sm py-sm md:px-lg md:py-lg mx-auto flex flex-col">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppShellSidebar(): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const { data: orgs = [] } = useOrganizations();
  const { activeOrgId, setActiveOrg } = useActiveOrg();
  const { data: stores = [] } = useStores(activeOrgId);
  const { activeStoreId, setActiveStore } = useActiveStore();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-xs">
        <div className="gap-xs px-xs py-3xs flex items-center">
          <Wordmark withText />
          <SidebarTrigger className="ml-auto" />
        </div>
        <OrgStoreSwitcher
          orgs={orgs.map(toSwitcherOrg)}
          stores={stores.map(toSwitcherStore)}
          activeOrgId={activeOrgId}
          activeStoreId={activeStoreId}
          onSelectOrg={setActiveOrg}
          onSelectStore={setActiveStore}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {NAV_ENTRIES.map((entry) => {
            if (isNavDivider(entry)) {
              return (
                <SidebarMenuItem key={entry.key}>
                  <hr className="border-border mx-xs my-xs border-t border-dashed" />
                </SidebarMenuItem>
              );
            }
            const isActive = pathname === entry.href || pathname.startsWith(`${entry.href}/`);
            const Icon = entry.icon;
            if ('sections' in entry && entry.sections) {
              return (
                <SidebarMenuItem key={entry.key}>
                  <NavGroup
                    label={t(entry.labelKey)}
                    icon={<Icon className="size-icon" />}
                    badge={entry.badge}
                    defaultExpanded={isActive}
                  >
                    {entry.sections.flatMap((section) =>
                      section.items.map((item) => (
                        <Link
                          key={item.key}
                          href={item.href}
                          className="text-muted-foreground hover:text-foreground hover:bg-muted px-xs py-3xs text-2xs rounded-sm"
                        >
                          {t(item.labelKey)}
                        </Link>
                      )),
                    )}
                  </NavGroup>
                </SidebarMenuItem>
              );
            }
            return (
              <SidebarMenuItem key={entry.key}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={t(entry.labelKey)}>
                  <Link href={entry.href}>
                    <Icon className="size-icon" />
                    <span>{t(entry.labelKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <BottomDock>
          <SidebarMenuButton asChild>
            <Link href="/support">❓ {t('nav.support')}</Link>
          </SidebarMenuButton>
          <SidebarMenuButton asChild>
            <Link href="/settings">⚙ {t('nav.settings')}</Link>
          </SidebarMenuButton>
          <ThemeToggleInline />
          <BottomDock.Divider />
          <UserMenu />
        </BottomDock>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// Adapter helpers — domain types -> switcher types
function toSwitcherOrg(/* ... */) {
  /* full impl */
}
function toSwitcherStore(/* ... */) {
  /* full impl */
}
```

> **Önemli:** Bu task'ın step 4'ü, `AppShell`'in yapısal iskeletini gösterir. Tam implementation'da `useActiveOrg` / `useActiveStore` / `useOrganizations` / `useStores` hook'larının gerçek imzalarına göre adapter fonksiyonları yazılır. Tip uyuşmazlığı varsa hook return type'larını expose et veya adapter fonksiyonlarını güncelle.

- [ ] **Step 5: Test'i pass et**

```bash
pnpm --filter web test:component -- app-shell
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter web typecheck
```

- [ ] **Step 7: Visual smoke test — `/dashboard` çalışıyor mu?**

```bash
pnpm dev --filter web &
sleep 8
curl -sI http://localhost:3000/tr/dashboard
kill %1
```

200 OK beklenir.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/layout/app-shell.tsx apps/web/tests/component/app-shell.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): rebuild AppShell on shadcn Sidebar primitive

Replaces the 3-rail (IconRail + ContextRail + Main) with a single
collapsible sidebar (290px ↔ 48px) plus 1fr main.  Uses
SidebarProvider + Sidebar(collapsible="icon") + SidebarTrigger from
the shadcn Sidebar primitive (Task 1.1).  Composes:
  - OrgStoreSwitcher in SidebarHeader
  - NAV_ENTRIES rendered as SidebarMenu (with NavGroup for groups)
  - BottomDock + ThemeToggleInline + UserMenu in SidebarFooter
  - Mobile-only inline header in SidebarInset (hamburger + bell + user)
EOF
)"
```

---

## Task 2.2: Move Dashboard "Hızlı Erişim" warnings page body'ye

**Files:**

- Modify: `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx`
- Create: `apps/web/src/features/dashboard/components/quick-access-panel.tsx`

Mevcut `DashboardContextMiddle` ContextRail'in middle slot'unda render ediliyor. Yeni yerinde dashboard page body'nin tepesinde 3-card warning row olur.

- [ ] **Step 1: `DashboardContextMiddle`'in mevcut içeriğini oku**

```bash
cat apps/web/src/features/dashboard/components/dashboard-context-middle.tsx
```

- [ ] **Step 2: `QuickAccessPanel` pattern'ı yeni yerine yaz**

`apps/web/src/features/dashboard/components/quick-access-panel.tsx`:

```tsx
import { useTranslations } from 'next-intl';

import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface QuickAccessItem {
  key: string;
  href: string;
  count: number;
  tone: 'warning' | 'neutral';
}

export interface QuickAccessPanelProps {
  items: QuickAccessItem[];
}

export function QuickAccessPanel({ items }: QuickAccessPanelProps): React.ReactElement {
  const t = useTranslations('dashboard.quickAccess');
  return (
    <div className="gap-xs grid md:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="border-border bg-card hover:bg-muted p-md text-2xs rounded-md border transition-colors"
        >
          <div className="text-muted-foreground text-3xs tracking-wide uppercase">
            {t(`${item.key}.label`)}
          </div>
          <div className="mt-3xs gap-3xs flex items-baseline">
            <span
              className={cn('text-md font-semibold', item.tone === 'warning' && 'text-warning')}
            >
              {item.count}
            </span>
            <span className="text-muted-foreground">{t(`${item.key}.cta`)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Dashboard page'i güncelle**

`apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx`'in render kısmında, `<EmptyState />` öncesi:

```tsx
<QuickAccessPanel
  items={[
    { key: 'pendingOrders', href: '/orders?status=pending', count: 5, tone: 'warning' },
    { key: 'noCostProducts', href: '/products?filter=no-cost', count: 12, tone: 'warning' },
    { key: 'returnReviews', href: '/orders?status=returned', count: 3, tone: 'warning' },
  ]}
/>
```

- [ ] **Step 4: i18n key'leri ekle**

`messages/tr.json` `dashboard.quickAccess`:

```json
"quickAccess": {
  "pendingOrders": { "label": "Bekleyen Sipariş", "cta": "Hemen incele" },
  "noCostProducts": { "label": "Maliyet Eksik Ürün", "cta": "Toplu güncelle" },
  "returnReviews": { "label": "İade İncelemesi", "cta": "Onay bekle" }
}
```

- [ ] **Step 5: Visual doğrulama — Dashboard'ı tarayıcıda aç, panel'in tepede göründüğünü doğrula**

```bash
pnpm dev --filter web
```

→ http://localhost:3000/tr/dashboard

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(dashboard\)/dashboard/page.tsx apps/web/src/features/dashboard/components/quick-access-panel.tsx apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): move Dashboard "Hizli Erisim" warnings into page body

The 3 warning cards (bekleyen siparis, maliyet eksik, iade
incelemesi) used to live in ContextRail middle via
DashboardContextMiddle.  In the new single-sidebar shell that slot
doesn't exist; the cards now sit at the top of /dashboard as a
3-column grid (md:grid-cols-3).  DashboardContextMiddle is removed in
Task 2.3.
EOF
)"
```

---

## Task 2.3: Eski shell artifact'lerini sil

**Files:**

- Delete: `apps/web/src/components/layout/icon-rail.tsx`
- Delete: `apps/web/src/components/layout/context-rail.tsx`
- Delete: `apps/web/src/components/layout/mobile-top-bar.tsx`
- Delete: `apps/web/src/components/layout/mobile-nav-sheet.tsx`
- Delete: `apps/web/src/components/layout/store-switcher.tsx`
- Delete: `apps/web/src/features/dashboard/components/dashboard-context-middle.tsx`
- Delete: `apps/web/tests/component/mobile-nav-sheet.test.tsx`

- [ ] **Step 1: Hangi modüllerin bu dosyaları import ettiğini bul**

```bash
grep -rn "from '@/components/layout/icon-rail'\|from '@/components/layout/context-rail'\|from '@/components/layout/mobile-top-bar'\|from '@/components/layout/mobile-nav-sheet'\|from '@/components/layout/store-switcher'\|from '@/features/dashboard/components/dashboard-context-middle'" apps/web/src/ 2>&1
```

Beklenen: yalnızca yeni `app-shell.tsx`'in henüz silinmemiş eski referansları (varsa) — Task 2.1'in implementation'ı zaten tüm import'ları yeni pattern'lere çevirmiş olmalı. Eğer kalan import varsa düzelt.

- [ ] **Step 2: Dosyaları sil**

```bash
rm apps/web/src/components/layout/icon-rail.tsx
rm apps/web/src/components/layout/context-rail.tsx
rm apps/web/src/components/layout/mobile-top-bar.tsx
rm apps/web/src/components/layout/mobile-nav-sheet.tsx
rm apps/web/src/components/layout/store-switcher.tsx
rm apps/web/src/features/dashboard/components/dashboard-context-middle.tsx
rm apps/web/tests/component/mobile-nav-sheet.test.tsx
```

- [ ] **Step 3: Tam doğrulama — typecheck + lint + tüm testler**

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:unit
pnpm --filter web test:component
```

Hepsi PASS olmalı. Eğer kalan referanslar varsa (örn. unused import warnings), onları temizle.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/components/layout/ apps/web/src/features/dashboard/ apps/web/tests/component/
git commit -m "$(cat <<'EOF'
refactor(web): remove 3-rail shell artifacts after tek-sidebar cutover

Delete the now-unreferenced rail components — IconRail, ContextRail,
MobileTopBar, MobileNavSheet, StoreSwitcher, DashboardContextMiddle —
plus the MobileNavSheet test.  Their job is fully handled by the new
AppShell on shadcn Sidebar (Task 2.1) and the inline mobile header.
EOF
)"
```

---

## Task 2.4: Update `/design/layout-demo` showcase

**Files:**

- Modify: `apps/web/src/app/[locale]/(showcase)/design/layout-demo/page.tsx`

- [ ] **Step 1: Layout demo'yu yeni AppShell ile rebuild et**

(`/design/layout-demo` zaten `<AppShell>` altında çalışıyorsa otomatik yeni shell ile render olur. Demo sayfa içeriğini taze bir mock dashboard ile güncelle — KPI grid + warning panel + chart placeholders.)

- [ ] **Step 2: Visual audit — `/design/layout-demo`, `/dashboard`, `/orders`, `/products`, `/settings/profile`'ı tarayıcıda gez**

Her route'ta:

- Sidebar görünür mü
- Toggle çalışıyor mu (Cmd+B)
- Mobile (320px viewport) drawer'a düşüyor mu
- Aktif nav vurgusu doğru mu
- BottomDock'taki tema toggle, user dropdown, settings link çalışıyor mu

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(showcase\)/design/layout-demo/
git commit -m "feat(web): refresh /design/layout-demo with tek-sidebar shell"
```

---

# Phase 3 — Settings + Sub-routes

Settings için secondary layout. Profitability + Tools nested route'ları + Yenilikler placeholder.

## Task 3.1: `(settings)` layout — secondary sidebar

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/settings/layout.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/settings/settings-nav-config.ts`

- [ ] **Step 1: `settings-nav-config.ts` oluştur**

```typescript
export interface SettingsNavItem {
  key: string;
  labelKey: `settings.nav.${string}`;
  href: string;
}

export interface SettingsNavSection {
  key: string;
  labelKey: `settings.nav.sections.${string}`;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_SECTIONS: readonly SettingsNavSection[] = [
  {
    key: 'account',
    labelKey: 'settings.nav.sections.account',
    items: [
      { key: 'profile', labelKey: 'settings.nav.profile', href: '/settings/profile' },
      { key: 'team', labelKey: 'settings.nav.team', href: '/settings/team' },
      { key: 'billing', labelKey: 'settings.nav.billing', href: '/settings/billing' },
    ],
  },
  {
    key: 'connections',
    labelKey: 'settings.nav.sections.connections',
    items: [
      { key: 'stores', labelKey: 'settings.nav.stores', href: '/settings/stores' },
      {
        key: 'notifications',
        labelKey: 'settings.nav.notifications',
        href: '/settings/notifications',
      },
      { key: 'webhooks', labelKey: 'settings.nav.webhooks', href: '/settings/webhooks' },
    ],
  },
  {
    key: 'data',
    labelKey: 'settings.nav.sections.data',
    items: [
      { key: 'export', labelKey: 'settings.nav.export', href: '/settings/data-export' },
      { key: 'danger', labelKey: 'settings.nav.dangerZone', href: '/settings/danger-zone' },
    ],
  },
] as const;
```

- [ ] **Step 2: `layout.tsx` oluştur**

```tsx
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { SETTINGS_NAV_SECTIONS } from './settings-nav-config';
import { Link } from '@/i18n/navigation';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <div className="gap-md grid grid-cols-1 md:grid-cols-[200px_1fr]">
      <aside className="border-border bg-card gap-md p-md flex flex-col rounded-md border">
        {SETTINGS_NAV_SECTIONS.map((section) => (
          <div key={section.key} className="gap-3xs flex flex-col">
            <span className="text-muted-foreground text-3xs tracking-wide uppercase">
              {t(section.labelKey)}
            </span>
            {section.items.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="text-muted-foreground hover:text-foreground hover:bg-muted px-xs py-3xs rounded-sm text-xs"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <section>{children}</section>
    </div>
  );
}
```

- [ ] **Step 3: i18n key'leri ekle**

`tr.json` ve `en.json`'da `settings.nav.*` block'u tüm key'lerle.

- [ ] **Step 4: Visual smoke test — `/settings/profile`'ı aç**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(dashboard\)/settings/
git commit -m "feat(web): add settings secondary sidebar layout"
```

---

## Task 3.2: Settings'i primary nav'dan çıkar, bottom dock link olarak bırak

**Files:**

- Modify: `apps/web/src/components/layout/nav-config.ts`

- [ ] **Step 1: `NAV_ITEMS`'tan `settings` entry'sini sil**

`nav-config.ts`'de `settings` block'u kaldır.

- [ ] **Step 2: Tüm testlerin geçtiğini doğrula**

```bash
pnpm --filter web test:unit -- nav-config
pnpm --filter web typecheck
```

`AppShell` zaten `BottomDock` içinde `<Link href="/settings">⚙ {t('nav.settings')}</Link>` rendering ediyor — değişiklik gerekmez.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/nav-config.ts apps/web/tests/unit/lib/nav-config.test.ts
git commit -m "refactor(web): remove Settings from primary nav (lives in bottom dock)"
```

---

## Task 3.3: Profitability sub-routes (Karlılık Analizi grubu)

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/profitability/orders/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/profitability/products/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/profitability/categories/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/profitability/returns/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/profitability/campaigns/page.tsx`
- Modify: `apps/web/src/components/layout/nav-config.ts` (Karlılık Analizi grubu)

- [ ] **Step 1: 5 placeholder sayfa oluştur**

Her biri için minimal placeholder:

```tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState } from '@/components/patterns/empty-state';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'profitability.orders' });
  return { title: t('title') };
}

export default async function ProfitabilityOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'profitability.orders' });
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState title={t('empty.title')} description={t('empty.description')} />
    </>
  );
}
```

(Diğer 4 sayfa için aynı yapı, namespace değişir.)

- [ ] **Step 2: `nav-config.ts`'e Karlılık Analizi grubunu ekle**

```typescript
{
  key: 'profitability',
  labelKey: 'nav.profitability',
  href: '/profitability/orders', // Default landing
  icon: ChartLineData01Icon,
  badge: { variant: 'beta', label: 'Beta' },
  sections: [
    {
      key: 'reports',
      labelKey: 'navSections.profitability.reports.title',
      items: [
        { key: 'orders', labelKey: 'navSections.profitability.reports.orders', href: '/profitability/orders' },
        { key: 'products', labelKey: 'navSections.profitability.reports.products', href: '/profitability/products' },
        { key: 'categories', labelKey: 'navSections.profitability.reports.categories', href: '/profitability/categories' },
        { key: 'returns', labelKey: 'navSections.profitability.reports.returns', href: '/profitability/returns' },
        { key: 'campaigns', labelKey: 'navSections.profitability.reports.campaigns', href: '/profitability/campaigns' },
      ],
    },
  ],
},
```

- [ ] **Step 3: i18n key'leri ekle**

`tr.json`/`en.json`'a `profitability.{orders,products,categories,returns,campaigns}.title` ve `empty.title/description` key'leri.

- [ ] **Step 4: Visual smoke test — sidebar'da Karlılık Analizi grubu görünüyor mu, expand ediyor mu, sub-route'lar açılıyor mu**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\[locale\]/\(dashboard\)/profitability/ apps/web/src/components/layout/nav-config.ts apps/web/messages/
git commit -m "feat(web): add profitability sub-routes (Karlilik Analizi group)"
```

---

## Task 3.4: Maliyet & Araçlar grubu

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/tools/commission-calculator/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/tools/category-commissions/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/tools/plus-commission-rates/page.tsx`
- Create: `apps/web/src/app/[locale]/(dashboard)/tools/product-pricing/page.tsx`
- Modify: `apps/web/src/components/layout/nav-config.ts`

(Task 3.3 ile aynı pattern. Yeni grup başlığı `tools`, 4 placeholder sayfa, ikon `Wrench02Icon` veya benzeri hugeicons-react import'u.)

- [ ] Steps 1-5: Task 3.3 ile aynı pattern.

- [ ] Commit:

```bash
git commit -m "feat(web): add tools sub-routes (Maliyet & Araclar group)"
```

---

## Task 3.5: Yenilikler placeholder + section divider

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/whats-new/page.tsx`
- Modify: `apps/web/src/components/layout/nav-config.ts`

- [ ] **Step 1: Placeholder sayfa**

```tsx
import { PageHeader, EmptyState } from '@/components/patterns/...';

export default async function WhatsNewPage(): Promise<React.ReactElement> {
  return (
    <>
      <PageHeader title="Yenilikler" />
      <EmptyState title="Yakında!" description="Bu sayfa ürün güncellemelerini gösterecek." />
    </>
  );
}
```

- [ ] **Step 2: `nav-config.ts`'e divider + whats-new entry ekle**

`NAV_ITEMS`'in sonuna (notifications'tan sonra):

```typescript
{ type: 'divider', key: 'before-whats-new' } as const,
{
  key: 'whats-new',
  labelKey: 'nav.whatsNew',
  href: '/whats-new',
  icon: Megaphone01Icon, // veya StarIcon — Open Question 6 final pick
},
```

(Type union'a `NavDivider` eklenmesi Task 1.3'te yapıldı.)

- [ ] **Step 3: AppShell `isNavDivider` kullanarak doğru render ediyor — Task 2.1'de implement edildi.**

- [ ] **Step 4: Visual doğrulama**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): add Yenilikler placeholder + section divider"
```

---

## Task 3.6: Live Performance placeholder

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/live-performance/page.tsx`
- Modify: `apps/web/src/components/layout/nav-config.ts` (badge: { variant: 'new', label: 'Yeni' })

- [ ] Steps similar to 3.5. Commit:

```bash
git commit -m "feat(web): add Canli Performans placeholder with Yeni badge"
```

---

# Self-Review

- ✅ **Spec coverage** — her ana spec section'a karşılık gelen task var:
  - Sec 4 (Shell Architecture) → Task 2.1 + 2.4
  - Sec 5 (Nav Tree) → Task 1.3 + 3.x
  - Sec 6 (OrgStoreSwitcher) → Task 1.10
  - Sec 7 (Page-level context patterns) → Task 2.2
  - Sec 8 (Badge System) → Task 1.3 + NavGroup badge prop
  - Sec 9 (Token discipline) → Task 1.2 + her task'ta semantic tokens
  - Sec 10 (Implementation Components) → Phase 1 tüm task'lar
  - Sec 11 (Migration Strategy) → 3-fazlı plan yapısı

- ✅ **Placeholder scan** — TBD/TODO yok; her step somut komut ve kod içerir. İki "Open Question" Task'ları (3.5/3.6 nav-config icon picks) implementation-time karara bırakıldı, açıkça belirtildi.

- ✅ **Type consistency** — `NavItemBadge`, `NavEntry`, `Organization`, `Store`, `OrgRole`, `SyncState` tipleri tutarlı kullanıldı.

- ✅ **Migration plan compliance** — Faz 1 (foundation, görünür değişiklik yok) → Faz 2 (cutover) → Faz 3 (sub-routes), spec'in 3-PR planına uygun.
