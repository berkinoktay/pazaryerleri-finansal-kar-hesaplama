# Dashboard Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PazarSync dashboard shell'ini 4-kolondan 3-kolona indir; activity rail kaldır; UserMenu'yu zenginleştir (theme + language + profile + help); per-page sub-nav pattern oluştur; Dashboard ana içeriğini Melontik-tier yoğunluğuna çıkar; mobile-responsive Sheet paterni ekle.

**Architecture:** Mevcut dual-rail shell'in yapısı korunur ama Activity rail tamamen silinir; ContextRail bottom kalkar, middle sayfaya göre adapte olan SubNavList renderler; Dashboard route'una özel StoreSummaryCard + PeriodPresetList; PageHeader actions slot'una NotificationBell + period picker + opsiyonel refresh; mobile breakpoint altında IconRail+ContextRail içeriği bir MobileNavSheet (shadcn Sheet) içine girer.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6, Tailwind CSS 4 + shadcn/ui (Popover, DropdownMenu, Sheet, ToggleGroup, Command, Tabs, Chart), next-intl 4, next-themes 0.5, hugeicons-react, Recharts (via shadcn `chart`), Decimal.js, Vitest 4 + @testing-library/react + happy-dom + MSW v2.

**Branch:** `feature/dashboard-shell-redesign` (zaten açık)

**Spec referansı:** `docs/superpowers/specs/2026-04-22-dashboard-shell-design.md`

**Commit politikası:** Kullanıcı "sırf doküman için commit atmayalım" dedi — spec dosyası ilk feature task'ının commit'iyle birlikte yer alacak (Task 2). Sonraki commit'ler task başına bir tane.

---

## File Structure

### Create

```
apps/web/src/components/patterns/
├── sub-nav-list.tsx                    # Generic count-badged sub-nav
├── rail-warning-card.tsx               # Conditional warning in rail middle
└── notification-bell.tsx               # Bell + popover + count badge

apps/web/src/components/layout/
├── mobile-top-bar.tsx                  # Mobile-only top bar (hamburger + bell + user)
└── mobile-nav-sheet.tsx                # Slide-over for IconRail + ContextRail content

apps/web/src/features/dashboard/
├── api/
│   └── dashboard.api.ts                # API client wrapper (placeholder until backend endpoint)
├── hooks/
│   └── use-dashboard-metrics.ts        # React Query hook
└── components/
    ├── store-summary-card.tsx          # Rail middle — store identity + meta
    ├── period-preset-list.tsx          # Rail middle — period presets
    ├── cost-breakdown-card.tsx         # Body — donut + 8 categories
    ├── profit-trend-card.tsx           # Body — line chart
    ├── net-profit-funnel-card.tsx      # Body — custom SVG funnel
    ├── product-metrics-card.tsx        # Body — product KPI panel
    ├── order-metrics-card.tsx          # Body — order KPI panel
    └── top-products-card.tsx           # Body — best/worst performers

apps/web/src/app/[locale]/(dashboard)/notifications/
└── page.tsx                            # /notifications placeholder

apps/web/tests/component/
├── notification-bell.test.tsx
├── sub-nav-list.test.tsx
├── period-preset-list.test.tsx
├── user-menu.test.tsx
├── mobile-nav-sheet.test.tsx
└── context-rail.test.tsx               # Per-page render logic
apps/web/tests/unit/hooks/
└── use-dashboard-metrics.test.ts       # MSW-backed
```

### Modify

```
apps/web/src/components/layout/app-shell.tsx          # 3-col grid + mobile top bar integration
apps/web/src/components/layout/context-rail.tsx       # bottom kaldır, middle per-page render
apps/web/src/components/layout/store-switcher.tsx     # prominent styling tweak
apps/web/src/components/layout/nav-config.ts          # count, tone, meta fields
apps/web/src/features/auth/components/user-menu.tsx   # header + theme + lang + profile + help + logout
apps/web/src/components/patterns/kpi-tile.tsx         # opt-in sparkline prop
apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx  # full body rebuild
apps/web/messages/tr.json                             # new keys + delete activityRail.*
apps/web/messages/en.json                             # parity with tr.json
apps/web/src/app/[locale]/(showcase)/design/layout-demo/page.tsx  # update to new shell
```

### Delete

```
apps/web/src/components/layout/activity-rail.tsx
```

---

## Phase 0 — Pre-flight

### Task 1: Verify clean baseline + dev environment

**Files:** none (verification only)

- [ ] **Step 1: Verify branch + git state**

```bash
git branch --show-current
git status --short
```

Expected: branch is `feature/dashboard-shell-redesign`, untracked file `docs/superpowers/specs/2026-04-22-dashboard-shell-design.md` (and possibly `.superpowers/` dir).

- [ ] **Step 2: Confirm `.superpowers/` is gitignored**

```bash
grep -E '\.superpowers' /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.gitignore || echo "MISSING"
```

If `MISSING`, add it:

```bash
echo "\n.superpowers/" >> /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.gitignore
```

- [ ] **Step 3: Verify pre-existing tests pass on this branch**

```bash
pnpm --filter @pazarsync/web test:unit -- --run
```

Expected: all pass (no test changes yet). If failing, stop and investigate — baseline broken.

- [ ] **Step 4: Verify `next-themes` provider is mounted in root layout**

```bash
grep -n "ThemeProvider" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/app/layout.tsx
```

Expected: a line referencing `<ThemeProvider>`. If missing, stop — Risk #1 from spec is unresolved and Phase 3 needs it.

- [ ] **Step 5: Start dev server in background for visual checks**

```bash
pnpm dev --filter web
```

Leave running. Open http://localhost:3000/tr/dashboard to confirm current sparse dashboard renders. This is the visual baseline.

---

## Phase 1 — Shell Foundation (chrome cleanup)

### Task 2: Delete ActivityRail + clean i18n

**Files:**

- Delete: `apps/web/src/components/layout/activity-rail.tsx`
- Modify: `apps/web/messages/tr.json` (remove `activityRail` namespace)
- Modify: `apps/web/messages/en.json` (remove `activityRail` namespace)

- [ ] **Step 1: Delete the file**

```bash
rm /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/components/layout/activity-rail.tsx
```

- [ ] **Step 2: Find and remove i18n keys**

```bash
grep -n "activityRail" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/tr.json
grep -n "activityRail" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/en.json
```

Open both files; remove the entire `"activityRail": {...}` block (and trailing comma if needed to keep JSON valid).

- [ ] **Step 3: Verify nothing imports the deleted file**

```bash
grep -rn "from '@/components/layout/activity-rail'" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src
grep -rn "ActivityRail" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src
```

Expected leftover references: `app-shell.tsx` (import + usage). They will be removed in Task 3. Showcase mocks file may have `MOCK_ACTIVITY` — leave for now, will re-purpose for /notifications page.

- [ ] **Step 4: Stage files (commit happens with Task 3 since deletion alone breaks build)**

```bash
git add apps/web/src/components/layout/activity-rail.tsx apps/web/messages/tr.json apps/web/messages/en.json
```

(no commit yet)

---

### Task 3: Convert AppShell to 3-column grid

**Files:**

- Modify: `apps/web/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Replace AppShell content**

Open `/Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/components/layout/app-shell.tsx` and replace the entire file with:

```tsx
'use client';

import * as React from 'react';

import { ContextRail } from '@/components/layout/context-rail';
import { IconRail } from '@/components/layout/icon-rail';
import { type Store } from '@/components/layout/store-switcher';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  /**
   * Organisation picker rendered at the top of the ContextRail.
   * Passed as a ReactNode so the shell stays dumb — the fetching,
   * cookie handling, and create-org modal live in the feature layer.
   */
  orgSwitcher?: React.ReactNode;
  stores?: Store[];
  activeStoreId?: string;
  onSelectStore?: (id: string) => void;
  onAddStore?: () => void;
  children: React.ReactNode;
}

/**
 * Three-column workspace shell — IconRail (48px) · ContextRail (220px,
 * sheet under md) · Content (1fr). Each page owns its own header via
 * <PageHeader>; the shell does not provide an app-level top bar.
 *
 * The notification bell lives in PageHeader actions, not in the shell.
 * On screens narrower than md, the IconRail and ContextRail are hidden
 * and replaced by a MobileNavSheet triggered from a top bar.
 */
export function AppShell({
  orgSwitcher,
  stores = [],
  activeStoreId,
  onSelectStore,
  onAddStore,
  children,
}: AppShellProps): React.ReactElement {
  return (
    <div className="bg-background text-foreground grid h-full grid-cols-[auto_auto_1fr] grid-rows-1 overflow-hidden">
      <div className="hidden md:block">
        <IconRail />
      </div>

      <div className="hidden md:block">
        <ContextRail
          orgSwitcher={orgSwitcher}
          stores={stores}
          activeStoreId={activeStoreId ?? ''}
          onSelectStore={onSelectStore ?? (() => undefined)}
          onAddStore={onAddStore}
        />
      </div>

      <main
        id="main"
        className={cn('relative min-w-0 overflow-y-auto', 'focus-visible:outline-none')}
      >
        <div className="max-w-content-max gap-lg px-lg py-lg mx-auto flex flex-col">{children}</div>
      </main>
    </div>
  );
}
```

Key changes from original:

- `grid-cols-[auto_auto_1fr_auto]` → `grid-cols-[auto_auto_1fr]` (no activity column)
- `IconRail` wrapped in `hidden md:block` (will be visible only on md+)
- `ActivityRail` import + usage + `activity` prop completely removed
- `onSyncNow` prop removed (sync button removed in Task 9)

- [ ] **Step 2: Find callers of removed props (`onSyncNow`, `activity`)**

```bash
grep -rn "onSyncNow\|activity=" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src
```

Expected hits in:

- `apps/web/src/features/stores/components/dashboard-store-launcher.tsx`
- `apps/web/src/app/[locale]/(showcase)/design/layout-demo/page.tsx`

For each: remove the prop assignment. Don't worry about TS errors yet — full lint runs at end of phase.

- [ ] **Step 3: Type check**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: clean. If `MobileTopBar` referenced anywhere — it doesn't exist yet, will be added in Phase 5. Should not be referenced now.

- [ ] **Step 4: Visual check**

In the running dev server, refresh `http://localhost:3000/tr/dashboard`. Expected:

- Three columns visible (icon + context + main)
- No bell column on right
- Layout still legible

- [ ] **Step 5: Commit (Task 2 + Task 3 bundled, includes spec doc)**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
git add apps/web/src/components/layout/app-shell.tsx \
        apps/web/src/components/layout/activity-rail.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json \
        apps/web/src/features/stores/components/dashboard-store-launcher.tsx \
        apps/web/src/app/[locale]/\(showcase\)/design/layout-demo/page.tsx \
        docs/superpowers/specs/2026-04-22-dashboard-shell-design.md \
        .gitignore
git commit -m "$(cat <<'EOF'
refactor(web): drop activity rail, switch shell to 3 columns

Removes ActivityRail (32px persistent right column) — competitor
analysis (Melontik, Tiyasis) confirmed the column adds chrome
without value. Bell will move to PageHeader actions in a follow-up
task. Includes the design spec under docs/superpowers/specs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: NotificationBell pattern

**Files:**

- Create: `apps/web/src/components/patterns/notification-bell.tsx`
- Create: `apps/web/tests/component/notification-bell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/component/notification-bell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { NotificationBell } from '@/components/patterns/notification-bell';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  notificationBell: {
    label: 'Bildirimler',
    empty: 'Bildirim yok',
    seeAll: 'Tümünü gör',
  },
};

function renderBell(props: Partial<React.ComponentProps<typeof NotificationBell>> = {}) {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <NotificationBell entries={[]} unreadCount={0} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('NotificationBell', () => {
  it('renders the trigger button with aria label', () => {
    renderBell();
    expect(screen.getByRole('button', { name: 'Bildirimler' })).toBeInTheDocument();
  });

  it('hides the count badge when unreadCount is 0', () => {
    renderBell({ unreadCount: 0 });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows the count badge when unreadCount > 0', () => {
    renderBell({ unreadCount: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the count display at 9+', () => {
    renderBell({ unreadCount: 42 });
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('opens the popover with empty state when entries is empty', async () => {
    const { user } = renderBell({ entries: [], unreadCount: 0 });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText('Bildirim yok')).toBeInTheDocument();
  });

  it('opens the popover and lists entries when present', async () => {
    const { user } = renderBell({
      entries: [
        { id: '1', icon: 'success', title: 'Sync tamam', timestamp: '3 dk' },
        { id: '2', icon: 'warning', title: '2 iade incele', timestamp: '15 dk' },
      ],
      unreadCount: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Bildirimler' }));
    expect(await screen.findByText('Sync tamam')).toBeInTheDocument();
    expect(screen.getByText('2 iade incele')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tümünü gör' })).toHaveAttribute(
      'href',
      '/notifications',
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @pazarsync/web test:unit -- --run notification-bell
```

Expected: FAIL — module `@/components/patterns/notification-bell` not found.

- [ ] **Step 3: Implement NotificationBell**

Create `apps/web/src/components/patterns/notification-bell.tsx`:

```tsx
'use client';

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Notification03Icon,
  Pulse01Icon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NotificationEntry {
  id: string;
  icon: 'success' | 'warning' | 'info';
  title: string;
  timestamp: string;
  source?: string;
}

const ENTRY_ICON = {
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  info: Pulse01Icon,
} as const;

const ENTRY_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export interface NotificationBellProps {
  entries: NotificationEntry[];
  unreadCount: number;
}

/**
 * Bell trigger + Popover with last entries. Lives in PageHeader.actions.
 * Replaces the deprecated ActivityRail. Full history is at /notifications.
 */
export function NotificationBell({
  entries,
  unreadCount,
}: NotificationBellProps): React.ReactElement {
  const t = useTranslations('notificationBell');
  const display = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={t('label')} className="relative">
          <Notification03Icon className="size-icon-sm" />
          {unreadCount > 0 ? (
            <span
              className={cn(
                'right-3xs top-3xs text-2xs absolute flex min-w-4 items-center justify-center rounded-full px-1 font-semibold',
                'bg-warning text-warning-foreground',
              )}
            >
              {display}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {entries.length === 0 ? (
          <div className="p-md text-muted-foreground text-center text-sm">{t('empty')}</div>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="gap-xs p-sm flex flex-col">
              {entries.slice(0, 5).map((entry) => {
                const Icon = ENTRY_ICON[entry.icon];
                return (
                  <li key={entry.id} className="gap-xs p-xs flex items-start rounded-md text-sm">
                    <Icon className={cn('size-icon-sm mt-3xs shrink-0', ENTRY_TONE[entry.icon])} />
                    <div className="gap-3xs flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground truncate">{entry.title}</span>
                      <span className="text-2xs text-muted-foreground">
                        {entry.timestamp}
                        {entry.source ? ` · ${entry.source}` : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
        <Separator />
        <Link
          href="/notifications"
          className="text-primary hover:bg-muted px-sm py-xs block text-center text-sm font-medium"
        >
          {t('seeAll')}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Add i18n keys**

Add to `apps/web/messages/tr.json` (top-level):

```json
"notificationBell": {
  "label": "Bildirimler",
  "empty": "Henüz bildirim yok",
  "seeAll": "Tümünü gör"
}
```

Add to `apps/web/messages/en.json`:

```json
"notificationBell": {
  "label": "Notifications",
  "empty": "No notifications yet",
  "seeAll": "See all"
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
pnpm --filter @pazarsync/web test:unit -- --run notification-bell
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/patterns/notification-bell.tsx \
        apps/web/tests/component/notification-bell.test.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add NotificationBell pattern

Bell trigger + Popover preview list + "See all" link to
/notifications. Replaces ActivityRail; will be slotted into
PageHeader.actions next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire NotificationBell into Dashboard PageHeader (smoke)

**Files:**

- Modify: `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx` (PageHeader actions only — temporary mock data; full body rebuild in Phase 4)

- [ ] **Step 1: Add bell with mock data to PageHeader actions**

Edit the `<PageHeader ... />` JSX in `dashboard/page.tsx`. Replace it with:

```tsx
<PageHeader
  title="Gösterge paneli"
  intent="Seçili mağaza ve dönem için özet finansal durum."
  meta={<SyncBadge state="fresh" lastSyncedAt={MOCK_LAST_SYNCED} source="Trendyol" />}
  actions={
    <NotificationBell
      entries={[
        { id: '1', icon: 'success', title: 'Sipariş senkronizasyonu tamam', timestamp: '3 dk' },
        { id: '2', icon: 'warning', title: '2 iade incelemeyi bekliyor', timestamp: '15 dk' },
      ]}
      unreadCount={2}
    />
  }
/>
```

Add the import at top:

```tsx
import { NotificationBell } from '@/components/patterns/notification-bell';
```

- [ ] **Step 2: Visual check**

Refresh dev server. Expected: bell icon appears top-right of PageHeader with orange "2" badge. Click → popover with 2 entries + "Tümünü gör" link (will 404 until Task 6).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/\(dashboard\)/dashboard/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire NotificationBell into Dashboard PageHeader

Mock entries until /v1/notifications backend lands. Bell is the
permanent home for unread alerts now that ActivityRail is gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: /notifications placeholder route

**Files:**

- Create: `apps/web/src/app/[locale]/(dashboard)/notifications/page.tsx`

- [ ] **Step 1: Create the route**

```tsx
import type { Metadata } from 'next';

import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';

export const metadata: Metadata = {
  title: 'Bildirimler',
};

export default function NotificationsPage(): React.ReactElement {
  return (
    <>
      <PageHeader title="Bildirimler" intent="Sistemden gelen tüm bildirimlerin geçmişi." />
      <EmptyState
        title="Bildirim merkezi yakında"
        description="Senkronizasyon olayları, yeni sipariş bildirimleri ve uyarı geçmişi burada listelenecek."
      />
    </>
  );
}
```

- [ ] **Step 2: Visual check**

Click "Tümünü gör" in the bell popover → /notifications loads with empty state.

- [ ] **Step 3: Add i18n key (optional metadata)** — skip for now; the title is hard-coded TR like the dashboard. To be revisited in Task 33 (i18n audit).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/\(dashboard\)/notifications/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): add /notifications placeholder route

Lands the "See all" link from NotificationBell. Body is an
EmptyState until the notifications endpoint and feed UI ship in
a follow-up plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: SubNavList pattern

**Files:**

- Create: `apps/web/src/components/patterns/sub-nav-list.tsx`
- Create: `apps/web/tests/component/sub-nav-list.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/component/sub-nav-list.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { SubNavList } from '@/components/patterns/sub-nav-list';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  test: {
    section: { title: 'Durum' },
    all: 'Tümü',
    pending: 'Bekleyen',
    issues: 'Uyumsuz',
  },
};

function renderList() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <SubNavList
        headingKey="test.section.title"
        currentHref="/orders?status=pending"
        items={[
          { key: 'all', labelKey: 'test.all', href: '/orders' },
          { key: 'pending', labelKey: 'test.pending', href: '/orders?status=pending', count: 12 },
          {
            key: 'issues',
            labelKey: 'test.issues',
            href: '/orders?status=issues',
            count: 3,
            tone: 'warning',
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe('SubNavList', () => {
  it('renders the heading', () => {
    renderList();
    expect(screen.getByText('Durum')).toBeInTheDocument();
  });

  it('renders each item as a link', () => {
    renderList();
    expect(screen.getByRole('link', { name: /Tümü/ })).toHaveAttribute('href', '/orders');
    expect(screen.getByRole('link', { name: /Bekleyen/ })).toHaveAttribute(
      'href',
      '/orders?status=pending',
    );
  });

  it('renders count badges when provided', () => {
    renderList();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the active item via aria-current', () => {
    renderList();
    const active = screen.getByRole('link', { name: /Bekleyen/ });
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('applies a warning tone class to flagged items', () => {
    renderList();
    const issues = screen.getByText('3');
    expect(issues.className).toMatch(/warning/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @pazarsync/web test:unit -- --run sub-nav-list
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement SubNavList**

Create `apps/web/src/components/patterns/sub-nav-list.tsx`:

```tsx
'use client';

import { type MessageKeys, type Messages, type NestedKeyOf, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

// AnyMessageKey is the typed message-key constraint defined in sub-nav-list.tsx;
// nav-config consumers naturally satisfy it via 'as const' literals.
type AnyMessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;

export type SubNavTone = 'default' | 'warning' | 'info';

export interface SubNavItem {
  key: string;
  labelKey: AnyMessageKey;
  href: string;
  count?: number;
  tone?: SubNavTone;
}

export interface SubNavListProps {
  /** i18n key for the optional heading shown above the list. */
  headingKey?: AnyMessageKey;
  /** Current pathname + query, used to compute active state. */
  currentHref: string;
  items: readonly SubNavItem[];
}

const TONE_CLASS: Record<SubNavTone, string> = {
  default: 'bg-muted text-muted-foreground',
  warning: 'bg-warning-surface text-warning',
  info: 'bg-info-surface text-info',
};

/**
 * Generic sub-navigation list with optional count badges and tone hints.
 * Designed for the ContextRail middle slot — slim, vertical, active item
 * painted in `bg-accent text-primary` (matches IconRail nav active state).
 */
export function SubNavList({
  headingKey,
  currentHref,
  items,
}: SubNavListProps): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="gap-3xs flex flex-col">
      {headingKey ? (
        <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
          {t(headingKey)}
        </span>
      ) : null}
      <ul className="gap-3xs flex flex-col">
        {items.map((item) => {
          const isActive = currentHref === item.href;
          const tone = item.tone ?? 'default';
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'gap-xs px-xs py-3xs duration-fast flex items-center justify-between rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  'focus-visible:outline-none',
                  isActive ? 'bg-accent text-primary font-medium' : 'text-muted-foreground',
                )}
              >
                <span>{t(item.labelKey)}</span>
                {item.count !== undefined ? (
                  <span
                    className={cn(
                      'text-2xs px-xs py-3xs rounded-full font-medium tabular-nums',
                      TONE_CLASS[tone],
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
pnpm --filter @pazarsync/web test:unit -- --run sub-nav-list
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/patterns/sub-nav-list.tsx \
        apps/web/tests/component/sub-nav-list.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add SubNavList pattern

Generic count-badged sub-navigation for the ContextRail middle
slot. Supports tone hints (default | warning | info) so warning
counts (eg. eksik maliyet) can pop visually.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extend nav-config with count, tone, meta fields

**Files:**

- Modify: `apps/web/src/components/layout/nav-config.ts`

- [ ] **Step 1: Replace nav-config.ts**

Open and replace the entire file:

```ts
import {
  ChartLineData01Icon,
  DashboardSquare02Icon,
  InvoiceIcon,
  PackageIcon,
  ReceiptDollarIcon,
  Settings02Icon,
  ShoppingBag01Icon,
} from 'hugeicons-react';

import type { SubNavItem } from '@/components/patterns/sub-nav-list';

/**
 * Shape of a section block inside the ContextRail middle slot.
 * `meta` is an alternative render hint — when set, the rail picks
 * a custom React component instead of rendering a SubNavList.
 */
export interface NavSection {
  key: string;
  labelKey: string;
  items: readonly SubNavItem[];
}

export interface NavItemBase {
  key: string;
  labelKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export type NavItem =
  | (NavItemBase & { sections: readonly NavSection[]; meta?: never })
  | (NavItemBase & { sections?: never; meta: 'dashboard' })
  | (NavItemBase & { sections?: never; meta?: never });

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'dashboard',
    labelKey: 'nav.dashboard',
    href: '/dashboard',
    icon: DashboardSquare02Icon,
    meta: 'dashboard',
  },
  {
    key: 'orders',
    labelKey: 'nav.orders',
    href: '/orders',
    icon: ShoppingBag01Icon,
    sections: [
      {
        key: 'status',
        labelKey: 'navSections.orders.status.title',
        items: [
          { key: 'all', labelKey: 'navSections.orders.status.all', href: '/orders' },
          {
            key: 'pending',
            labelKey: 'navSections.orders.status.pending',
            href: '/orders?status=pending',
          },
          {
            key: 'shipped',
            labelKey: 'navSections.orders.status.shipped',
            href: '/orders?status=shipped',
          },
          {
            key: 'delivered',
            labelKey: 'navSections.orders.status.delivered',
            href: '/orders?status=delivered',
          },
          {
            key: 'returned',
            labelKey: 'navSections.orders.status.returned',
            href: '/orders?status=returned',
            tone: 'warning',
          },
        ],
      },
    ],
  },
  {
    key: 'products',
    labelKey: 'nav.products',
    href: '/products',
    icon: PackageIcon,
    sections: [
      {
        key: 'catalog',
        labelKey: 'navSections.products.catalog.title',
        items: [
          { key: 'active', labelKey: 'navSections.products.catalog.active', href: '/products' },
          {
            key: 'draft',
            labelKey: 'navSections.products.catalog.draft',
            href: '/products?status=draft',
          },
          {
            key: 'no-cost',
            labelKey: 'navSections.products.catalog.noCost',
            href: '/products?filter=no-cost',
            tone: 'warning',
          },
          {
            key: 'no-desi',
            labelKey: 'navSections.products.catalog.noDesi',
            href: '/products?filter=no-desi',
            tone: 'warning',
          },
          {
            key: 'low-stock',
            labelKey: 'navSections.products.catalog.lowStock',
            href: '/products?filter=low-stock',
          },
        ],
      },
      {
        key: 'meta',
        labelKey: 'navSections.products.meta.title',
        items: [
          { key: 'costs', labelKey: 'navSections.products.meta.costs', href: '/products/costs' },
        ],
      },
    ],
  },
  {
    key: 'profitability',
    labelKey: 'nav.profitability',
    href: '/profitability',
    icon: ChartLineData01Icon,
    sections: [
      {
        key: 'reports',
        labelKey: 'navSections.profitability.reports.title',
        items: [
          {
            key: 'order',
            labelKey: 'navSections.profitability.reports.order',
            href: '/profitability/orders',
          },
          {
            key: 'product',
            labelKey: 'navSections.profitability.reports.product',
            href: '/profitability/products',
          },
          {
            key: 'category',
            labelKey: 'navSections.profitability.reports.category',
            href: '/profitability/categories',
          },
          {
            key: 'return',
            labelKey: 'navSections.profitability.reports.return',
            href: '/profitability/returns',
          },
          {
            key: 'campaign',
            labelKey: 'navSections.profitability.reports.campaign',
            href: '/profitability/campaigns',
          },
        ],
      },
    ],
  },
  {
    key: 'reconciliation',
    labelKey: 'nav.reconciliation',
    href: '/reconciliation',
    icon: InvoiceIcon,
    sections: [
      {
        key: 'status',
        labelKey: 'navSections.reconciliation.status.title',
        items: [
          {
            key: 'matched',
            labelKey: 'navSections.reconciliation.status.matched',
            href: '/reconciliation?status=matched',
          },
          {
            key: 'pending',
            labelKey: 'navSections.reconciliation.status.pending',
            href: '/reconciliation?status=pending',
          },
          {
            key: 'mismatch',
            labelKey: 'navSections.reconciliation.status.mismatch',
            href: '/reconciliation?status=mismatch',
            tone: 'warning',
          },
        ],
      },
    ],
  },
  {
    key: 'expenses',
    labelKey: 'nav.expenses',
    href: '/expenses',
    icon: ReceiptDollarIcon,
    sections: [
      {
        key: 'category',
        labelKey: 'navSections.expenses.category.title',
        items: [
          { key: 'all', labelKey: 'navSections.expenses.category.all', href: '/expenses' },
          {
            key: 'product',
            labelKey: 'navSections.expenses.category.product',
            href: '/expenses?category=product',
          },
          {
            key: 'ad',
            labelKey: 'navSections.expenses.category.ad',
            href: '/expenses?category=ad',
          },
          {
            key: 'packaging',
            labelKey: 'navSections.expenses.category.packaging',
            href: '/expenses?category=packaging',
          },
          {
            key: 'other',
            labelKey: 'navSections.expenses.category.other',
            href: '/expenses?category=other',
          },
        ],
      },
    ],
  },
  {
    key: 'settings',
    labelKey: 'nav.settings',
    href: '/settings',
    icon: Settings02Icon,
    sections: [
      {
        key: 'sections',
        labelKey: 'navSections.settings.sections.title',
        items: [
          {
            key: 'profile',
            labelKey: 'navSections.settings.sections.profile',
            href: '/settings/profile',
          },
          { key: 'team', labelKey: 'navSections.settings.sections.team', href: '/settings/team' },
          {
            key: 'billing',
            labelKey: 'navSections.settings.sections.billing',
            href: '/settings/billing',
          },
          {
            key: 'stores',
            labelKey: 'navSections.settings.sections.stores',
            href: '/settings/stores',
          },
          {
            key: 'notifications',
            labelKey: 'navSections.settings.sections.notifications',
            href: '/settings/notifications',
          },
        ],
      },
    ],
  },
] as const;

export type NavIconComponent = NavItem['icon'];
```

- [ ] **Step 2: Add new i18n keys**

In `apps/web/messages/tr.json`, add/extend the `navSections` namespace. Add new keys: `products.catalog.noCost`, `products.catalog.noDesi`, `products.catalog.lowStock`, `products.meta.title`, `products.meta.costs`, `profitability.reports.*` (5), `reconciliation.status.*` (3 + title), `expenses.category.*` (5 + title), `settings.sections.*` (5 + title). Mirror in `en.json`.

Example addition (TR):

```json
"navSections": {
  "orders": { ... existing ... },
  "products": {
    "catalog": {
      "title": "Katalog",
      "active": "Aktif",
      "draft": "Taslak",
      "noCost": "Maliyetsiz",
      "noDesi": "Desisiz",
      "lowStock": "Düşük stok"
    },
    "meta": {
      "title": "Ek bilgiler",
      "costs": "Maliyetler"
    }
  },
  "profitability": {
    "reports": {
      "title": "Raporlar",
      "order": "Sipariş",
      "product": "Ürün",
      "category": "Kategori",
      "return": "İade",
      "campaign": "Reklam"
    }
  },
  "reconciliation": {
    "status": {
      "title": "Mutabakat durumu",
      "matched": "Eşleşen",
      "pending": "Bekleyen",
      "mismatch": "Uyumsuz"
    }
  },
  "expenses": {
    "category": {
      "title": "Kategori",
      "all": "Tümü",
      "product": "Ürün maliyeti",
      "ad": "Reklam",
      "packaging": "Paketleme",
      "other": "Diğer"
    }
  },
  "settings": {
    "sections": {
      "title": "Bölümler",
      "profile": "Profil",
      "team": "Ekip",
      "billing": "Fatura",
      "stores": "Mağaza bağlantıları",
      "notifications": "Bildirimler"
    }
  }
}
```

EN parity (use English labels): "Catalog", "Active", "Draft", "Missing cost", "Missing desi", "Low stock", "Reports", "Orders", "Products", "Categories", "Returns", "Campaigns", "Reconciliation status", "Matched", "Pending", "Mismatch", "Category", "All", "Product cost", "Ads", "Packaging", "Other", "Sections", "Profile", "Team", "Billing", "Store connections", "Notifications".

- [ ] **Step 3: Type check**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: clean. Discriminated union ensures `meta: 'dashboard'` items can't have `sections` and vice versa.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/nav-config.ts \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): extend nav-config with count, tone, meta fields

Sub-nav now covers Reconciliation, Expenses, Settings (previously
empty). Adds tone hints for warning-style filter presets (eksik
maliyet, iade, mutabakat uyumsuzluğu). Dashboard switches to a
`meta: 'dashboard'` sentinel so the rail can render a custom
component (StoreSummaryCard + PeriodPresetList) instead of a
SubNavList.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Refactor ContextRail (drop bottom, per-page middle)

**Files:**

- Modify: `apps/web/src/components/layout/context-rail.tsx`
- Create: `apps/web/tests/component/context-rail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/component/context-rail.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { ContextRail } from '@/components/layout/context-rail';
import { render, screen } from '@/../tests/helpers/render';

vi.mock('@/i18n/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/navigation')>();
  return {
    ...actual,
    usePathname: () => '/orders',
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

const messages = {
  contextRail: { ariaLabel: 'Context rail' },
  nav: { orders: 'Siparişler' },
  navSections: {
    orders: {
      status: {
        title: 'Durum',
        all: 'Tümü',
        pending: 'Bekleyen',
        shipped: 'Kargoda',
        delivered: 'Teslim',
        returned: 'İade',
      },
    },
  },
  storeSwitcher: {
    searchPlaceholder: 'Ara',
    empty: 'Bulunamadı',
    heading: 'Mağazalar',
    active: 'aktif',
    addStore: 'Yeni mağaza',
  },
};

const stores = [
  { id: 's1', name: 'Trendyol TR', platform: 'TRENDYOL' as const, status: 'active' as const },
];

function renderRail() {
  return render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <ContextRail
        orgSwitcher={<span>org</span>}
        stores={stores}
        activeStoreId="s1"
        onSelectStore={() => undefined}
      />
    </NextIntlClientProvider>,
  );
}

describe('ContextRail', () => {
  it('renders the org switcher in the top slot', () => {
    renderRail();
    expect(screen.getByText('org')).toBeInTheDocument();
  });

  it('renders the active store switcher', () => {
    renderRail();
    expect(screen.getByText('Trendyol TR')).toBeInTheDocument();
  });

  it('renders the page-specific sub-nav for /orders', () => {
    renderRail();
    expect(screen.getByText('Durum')).toBeInTheDocument();
    expect(screen.getByText('Tümü')).toBeInTheDocument();
    expect(screen.getByText('Bekleyen')).toBeInTheDocument();
  });

  it('does NOT render a "Şimdi senkronize et" button (bottom removed)', () => {
    renderRail();
    expect(screen.queryByText(/senkronize et/i)).not.toBeInTheDocument();
  });

  it('does NOT render a language switcher (moved to user menu)', () => {
    renderRail();
    expect(screen.queryByText(/TR|EN/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @pazarsync/web test:unit -- --run context-rail
```

Expected: failures on "no senkronize et" and "no language switcher" (currently both render).

- [ ] **Step 3: Replace ContextRail**

Open `/Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/components/layout/context-rail.tsx` and replace with:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { NAV_ITEMS, type NavItem } from '@/components/layout/nav-config';
import { StoreSwitcher, type Store } from '@/components/layout/store-switcher';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePathname } from '@/i18n/navigation';

const DashboardContextMiddle = React.lazy(
  () => import('@/features/dashboard/components/dashboard-context-middle'),
);

export interface ContextRailProps {
  orgSwitcher?: React.ReactNode;
  stores: Store[];
  activeStoreId: string;
  onSelectStore: (id: string) => void;
  onAddStore?: () => void;
}

/**
 * Second column of the 3-rail shell. Top: org + prominent store
 * switcher. Middle: page-specific (sub-nav, or a custom component
 * via meta). No bottom — utility actions (sync, language, theme)
 * moved to PageHeader actions and UserMenu respectively.
 */
export function ContextRail({
  orgSwitcher,
  stores,
  activeStoreId,
  onSelectStore,
  onAddStore,
}: ContextRailProps): React.ReactElement {
  const pathname = usePathname();
  const tRail = useTranslations('contextRail');

  const activeItem: NavItem | undefined = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <aside
      aria-label={tRail('ariaLabel')}
      className="w-rail-context border-border bg-background flex h-full flex-col border-r"
    >
      <div className="gap-xs border-border p-sm flex flex-col border-b">
        {orgSwitcher}
        {stores.length > 0 ? (
          <StoreSwitcher
            stores={stores}
            activeStoreId={activeStoreId}
            onSelect={onSelectStore}
            onAddStore={onAddStore}
          />
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        <div className="gap-md px-sm py-md flex flex-col">
          {activeItem?.meta === 'dashboard' ? (
            <React.Suspense fallback={null}>
              <DashboardContextMiddle />
            </React.Suspense>
          ) : null}
          {activeItem && 'sections' in activeItem && activeItem.sections
            ? activeItem.sections.map((section) => (
                <SubNavList
                  key={section.key}
                  headingKey={section.labelKey}
                  currentHref={`${pathname}${typeof window !== 'undefined' ? window.location.search : ''}`}
                  items={section.items}
                />
              ))
            : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
```

Notes:

- `currentHref` reads `window.location.search` when available — SSR fallback is just the pathname (active state may flash, acceptable trade-off; if visible during testing, switch to `useSearchParams` from `next/navigation`).
- `DashboardContextMiddle` is lazy-loaded so the rail's bundle stays slim for non-dashboard pages.

- [ ] **Step 4: Stub the lazy-loaded module so tests pass**

Create `apps/web/src/features/dashboard/components/dashboard-context-middle.tsx`:

```tsx
'use client';

/**
 * Composite for the ContextRail middle slot on the Dashboard route.
 * Concrete content (StoreSummaryCard + PeriodPresetList +
 * RailWarningCard) is filled in by Tasks 10–12.
 */
export default function DashboardContextMiddle(): React.ReactElement {
  return <div data-testid="dashboard-context-middle" />;
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
pnpm --filter @pazarsync/web test:unit -- --run context-rail
```

Expected: 5 tests pass.

- [ ] **Step 6: Visual check**

Refresh dev server. Expected:

- Bottom of context rail empty (no sync / add-store / language).
- `/orders` shows status sub-nav.
- `/dashboard` shows the empty stub div (will fill with Tasks 10–12).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/context-rail.tsx \
        apps/web/src/features/dashboard/components/dashboard-context-middle.tsx \
        apps/web/tests/component/context-rail.test.tsx
git commit -m "$(cat <<'EOF'
refactor(web): rework ContextRail — drop bottom, per-page middle

Bottom slot (sync / add-store / language) removed. Middle now
renders SubNavList per nav-config, or — for Dashboard — a
lazy-loaded DashboardContextMiddle composite that hosts
store-summary + period-presets (fleshed out in subsequent tasks).
StoreSwitcher's add-store action remains the canonical entry point
for connecting a new store.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Drop orphan activity-rail tokens**

Remove the orphaned tokens left by the activity-rail removal:

- `apps/web/src/app/tokens/spacing.css` — delete the `--size-rail-activity` and `--size-rail-activity-open` declarations (currently lines 34-35 area).
- `apps/web/src/app/globals.css` — delete the matching `--spacing-rail-activity` and `--spacing-rail-activity-open` lines (around line 147-148).

Verify zero references: `grep -rn "rail-activity" apps/web/src` should be empty after the edit.

Stage these into the same Task 9 commit (no separate commit needed).

---

### Task 10: StoreSwitcher prominence tweak

**Files:**

- Modify: `apps/web/src/components/layout/store-switcher.tsx`

Goal: enlarge the active store chip so it reads as the rail's primary identity (not "another dropdown"). Add a platform glyph, bump padding, and surface the status dot more prominently.

- [ ] **Step 1: Replace the trigger button JSX**

In `store-switcher.tsx`, find the `<PopoverTrigger asChild>` block. Replace its `<button>` with:

```tsx
<button
  type="button"
  className={cn(
    'gap-sm border-border bg-background px-sm py-xs duration-fast flex w-full items-center rounded-md border text-left text-sm shadow-xs transition-colors',
    'hover:border-border-strong',
    'focus-visible:outline-none',
  )}
>
  <span
    className={cn(
      'flex size-7 shrink-0 items-center justify-center rounded-md font-bold uppercase',
      active.platform === 'TRENDYOL'
        ? 'bg-warning-surface text-warning'
        : 'bg-info-surface text-info',
    )}
    aria-hidden="true"
  >
    {active.platform === 'TRENDYOL' ? 'T' : 'H'}
  </span>
  <span className="flex min-w-0 flex-1 flex-col leading-tight">
    <span className="text-foreground truncate font-semibold">{active.name}</span>
    <span className="text-2xs gap-3xs flex items-center">
      <span className={cn('size-1.5 rounded-full', STATUS_TONE[active.status])} />
      <span className="text-muted-foreground">{PLATFORM_LABEL[active.platform]}</span>
    </span>
  </span>
  <ArrowDown01Icon className="size-icon-sm text-muted-foreground shrink-0" />
</button>
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: clean. Tokens used (`bg-warning-surface`, `bg-info-surface`) are already in the design system per CLAUDE.md.

- [ ] **Step 3: Visual check**

Refresh dev server with a connected store (use seed or click "Mağazanı bağla" in the dashboard body). Expected: store chip is taller (~48px), shows a yellow/blue platform badge + bold name + status dot + platform label.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/store-switcher.tsx
git commit -m "$(cat <<'EOF'
refactor(web): make StoreSwitcher visually prominent in ContextRail

Adds a platform glyph (T/H), bumps padding, and surfaces the
status dot inline with the platform label. Vision mandates that
"store is a required selection" — the chip should read as the
rail's primary identity, not another small dropdown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Dashboard Rail Content

### Task 11: StoreSummaryCard

**Files:**

- Create: `apps/web/src/features/dashboard/components/store-summary-card.tsx`

- [ ] **Step 1: Implement the component (presentational, no test required)**

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

export interface StoreSummary {
  commissionPercent: number;
  activeProducts: number;
  apiHealth: 'healthy' | 'degraded' | 'down';
  lastSyncedLabel: string;
}

export interface StoreSummaryCardProps {
  data: StoreSummary | undefined;
}

const HEALTH_TONE = {
  healthy: 'text-success',
  degraded: 'text-warning',
  down: 'text-destructive',
} as const;

const HEALTH_LABEL_KEY = {
  healthy: 'storeSummary.health.healthy',
  degraded: 'storeSummary.health.degraded',
  down: 'storeSummary.health.down',
} as const;

/**
 * Compact "store at a glance" card for the Dashboard ContextRail
 * middle. Three quiet rows — commission, active SKUs, API health.
 * Shows skeleton lines when `data` is undefined.
 */
export function StoreSummaryCard({ data }: StoreSummaryCardProps): React.ReactElement {
  const t = useTranslations();
  return (
    <div className="gap-2xs flex flex-col">
      <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
        {t('storeSummary.heading')}
      </span>
      <div className="gap-xs px-xs py-xs flex flex-col text-sm">
        <Row
          label={t('storeSummary.commission')}
          value={data ? `%${data.commissionPercent.toFixed(1)}` : '—'}
        />
        <Row
          label={t('storeSummary.activeProducts')}
          value={data ? String(data.activeProducts) : '—'}
        />
        <Row
          label={t('storeSummary.apiHealth')}
          value={
            data ? (
              <span className={cn('font-medium', HEALTH_TONE[data.apiHealth])}>
                ● {t(HEALTH_LABEL_KEY[data.apiHealth])}
              </span>
            ) : (
              '—'
            )
          }
        />
        <Row label={t('storeSummary.lastSync')} value={data ? data.lastSyncedLabel : '—'} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys**

TR (`apps/web/messages/tr.json`, top-level):

```json
"storeSummary": {
  "heading": "Mağaza özeti",
  "commission": "Komisyon",
  "activeProducts": "Aktif ürün",
  "apiHealth": "API",
  "lastSync": "Son sync",
  "health": {
    "healthy": "Sağlıklı",
    "degraded": "Yavaş",
    "down": "Çalışmıyor"
  }
}
```

EN: "Store summary", "Commission", "Active products", "API", "Last sync", "Healthy", "Degraded", "Down".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/store-summary-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add StoreSummaryCard for Dashboard ContextRail

Quiet "store at a glance" card — commission rate, active SKUs,
API health, last sync. Renders dashes when data is loading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: PeriodPresetList

**Files:**

- Create: `apps/web/src/features/dashboard/components/period-preset-list.tsx`
- Create: `apps/web/tests/component/period-preset-list.test.tsx`

The preset list is interactive — when a user clicks a preset the URL `?period=last-30d` updates and the dashboard refetches. We use `nuqs` (already in the stack per CLAUDE.md "URL state").

- [ ] **Step 1: Confirm `nuqs` is installed**

```bash
pnpm --filter @pazarsync/web list nuqs 2>&1 | grep -E "nuqs"
```

If empty, install it:

```bash
pnpm --filter @pazarsync/web add nuqs
```

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/tests/component/period-preset-list.test.tsx
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsAdapter } from 'nuqs/adapters/react';

import {
  PeriodPresetList,
  PERIOD_PRESETS,
} from '@/features/dashboard/components/period-preset-list';
import { render, screen } from '@/../tests/helpers/render';

const messages = {
  periodPresets: {
    heading: 'Dönem',
    'last-30d': 'Son 30 gün',
    'this-month': 'Bu ay',
    'last-7d': 'Son 7 gün',
    'this-quarter': 'Bu çeyrek',
    custom: 'Özel…',
  },
};

function renderList() {
  return render(
    <NuqsAdapter>
      <NextIntlClientProvider locale="tr" messages={messages}>
        <PeriodPresetList />
      </NextIntlClientProvider>
    </NuqsAdapter>,
  );
}

describe('PeriodPresetList', () => {
  it('renders all presets defined in PERIOD_PRESETS', () => {
    renderList();
    for (const preset of PERIOD_PRESETS) {
      expect(screen.getByText(messages.periodPresets[preset.key])).toBeInTheDocument();
    }
  });

  it('marks "last-30d" active when no period in URL (default)', () => {
    renderList();
    const active = screen.getByRole('button', { name: 'Son 30 gün' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches active preset on click', async () => {
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Bu ay' }));
    expect(screen.getByRole('button', { name: 'Bu ay' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Son 30 gün' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm --filter @pazarsync/web test:unit -- --run period-preset-list
```

Expected: fail (module not found).

- [ ] **Step 4: Implement**

```tsx
// apps/web/src/features/dashboard/components/period-preset-list.tsx
'use client';

import { useTranslations } from 'next-intl';
import { parseAsStringEnum, useQueryState } from 'nuqs';

import { cn } from '@/lib/utils';

export const PERIOD_PRESETS = [
  { key: 'last-30d' as const },
  { key: 'this-month' as const },
  { key: 'last-7d' as const },
  { key: 'this-quarter' as const },
  { key: 'custom' as const },
] as const;

export type PeriodKey = (typeof PERIOD_PRESETS)[number]['key'];

const PERIOD_KEYS = PERIOD_PRESETS.map((p) => p.key);

export function PeriodPresetList(): React.ReactElement {
  const t = useTranslations('periodPresets');
  const [period, setPeriod] = useQueryState(
    'period',
    parseAsStringEnum<PeriodKey>(PERIOD_KEYS).withDefault('last-30d'),
  );

  return (
    <div className="gap-2xs flex flex-col">
      <span className="px-xs text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
        {t('heading')}
      </span>
      <div className="gap-3xs flex flex-col">
        {PERIOD_PRESETS.map(({ key }) => {
          const isActive = period === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setPeriod(key)}
              className={cn(
                'gap-xs px-xs py-3xs duration-fast flex items-center rounded-md text-left text-sm transition-colors',
                'hover:bg-muted',
                'focus-visible:outline-none',
                isActive ? 'bg-accent text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {t(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add i18n keys**

TR `periodPresets`: heading "Dönem", last-30d "Son 30 gün", this-month "Bu ay", last-7d "Son 7 gün", this-quarter "Bu çeyrek", custom "Özel…".

EN: "Period", "Last 30 days", "This month", "Last 7 days", "This quarter", "Custom…".

- [ ] **Step 6: Run test, verify pass**

```bash
pnpm --filter @pazarsync/web test:unit -- --run period-preset-list
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/dashboard/components/period-preset-list.tsx \
        apps/web/tests/component/period-preset-list.test.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json \
        apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): add PeriodPresetList for Dashboard ContextRail

URL-bound period preset list (nuqs). Switching a preset updates
?period=… and any subscribed hook (useDashboardMetrics) refetches
with the new range. Last-30d is the default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: RailWarningCard pattern

**Files:**

- Create: `apps/web/src/components/patterns/rail-warning-card.tsx`

- [ ] **Step 1: Implement (pure presentational)**

```tsx
'use client';

import { AlertCircleIcon } from 'hugeicons-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface RailWarningCardProps {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  tone?: 'warning' | 'destructive';
}

const TONE = {
  warning: {
    bg: 'bg-warning-surface',
    border: 'border-warning/40',
    title: 'text-warning',
    body: 'text-warning',
  },
  destructive: {
    bg: 'bg-destructive-surface',
    border: 'border-destructive/40',
    title: 'text-destructive',
    body: 'text-destructive',
  },
} as const;

/**
 * Slim warning card for the ContextRail middle. Conditional —
 * only render when there's an actionable issue (eksik maliyet,
 * sync hatası, vb.). Optional CTA links to the page that resolves it.
 */
export function RailWarningCard({
  title,
  description,
  ctaLabel,
  ctaHref,
  tone = 'warning',
}: RailWarningCardProps): React.ReactElement {
  const t = TONE[tone];
  return (
    <div className={cn('p-xs gap-3xs flex flex-col rounded-md border', t.bg, t.border)}>
      <div className="gap-3xs flex items-center">
        <AlertCircleIcon className={cn('size-icon-sm', t.title)} />
        <span className={cn('text-xs font-semibold', t.title)}>{title}</span>
      </div>
      <p className={cn('text-2xs', t.body)}>{description}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="text-primary text-xs font-semibold hover:underline">
          {ctaLabel} →
        </Link>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/patterns/rail-warning-card.tsx
git commit -m "$(cat <<'EOF'
feat(web): add RailWarningCard pattern

Conditional warning card for ContextRail middle. Used by Dashboard
when product cost data is missing; reusable on Products page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Hook DashboardContextMiddle to real components

**Files:**

- Modify: `apps/web/src/features/dashboard/components/dashboard-context-middle.tsx`

- [ ] **Step 1: Replace stub with real composite**

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { RailWarningCard } from '@/components/patterns/rail-warning-card';
import { PeriodPresetList } from '@/features/dashboard/components/period-preset-list';
import {
  StoreSummaryCard,
  type StoreSummary,
} from '@/features/dashboard/components/store-summary-card';

// MOCK until backend endpoint lands — see task 21 for the real hook.
const MOCK_SUMMARY: StoreSummary = {
  commissionPercent: 14.5,
  activeProducts: 12,
  apiHealth: 'healthy',
  lastSyncedLabel: '3 dk',
};

const MOCK_MISSING_COST_COUNT = 12;

/**
 * Composite for the ContextRail middle slot on the Dashboard route.
 * Lazy-loaded by ContextRail so non-dashboard routes don't pay the
 * weight.
 */
export default function DashboardContextMiddle(): React.ReactElement {
  const t = useTranslations('dashboardRail');
  return (
    <>
      <StoreSummaryCard data={MOCK_SUMMARY} />
      <PeriodPresetList />
      {MOCK_MISSING_COST_COUNT > 0 ? (
        <RailWarningCard
          title={t('warning.missingCost.title')}
          description={t('warning.missingCost.description', { count: MOCK_MISSING_COST_COUNT })}
          ctaLabel={t('warning.missingCost.cta')}
          ctaHref="/products?filter=no-cost"
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Add i18n keys**

TR `dashboardRail.warning.missingCost`: title "Eksik maliyet", description "{count} ürün maliyet bekliyor", cta "Tamamla".
EN: "Missing cost", "{count} product(s) need cost data", "Complete".

`{count}` is next-intl's ICU placeholder — already supported by the project.

- [ ] **Step 3: Visual check**

Refresh dev server. /dashboard rail should now show: store summary lines + period presets (last-30d active) + yellow warning card with "Tamamla →" link.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/dashboard/components/dashboard-context-middle.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): assemble DashboardContextMiddle composite

Slots StoreSummaryCard + PeriodPresetList + conditional
RailWarningCard into the Dashboard rail middle. Mock data until
useDashboardMetrics lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — UserMenu Expansion

### Task 15: Rebuild UserMenu (header + theme + lang + profile + help + logout)

**Files:**

- Modify: `apps/web/src/features/auth/components/user-menu.tsx`
- Create: `apps/web/tests/component/user-menu.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/component/user-menu.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { UserMenu } from '@/features/auth/components/user-menu';
import { render, screen } from '@/../tests/helpers/render';

vi.mock('@/features/auth/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { email: 'b@example.com', fullName: 'Berkin' } }),
}));
vi.mock('@/features/auth/hooks/use-sign-out', () => ({
  useSignOut: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));
vi.mock('@/i18n/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ replace: vi.fn() }),
    usePathname: () => '/dashboard',
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  };
});

const messages = {
  auth: { userMenu: { signOut: 'Çıkış yap' } },
  userMenu: {
    profile: 'Profil',
    settings: 'Ayarlar',
    theme: { heading: 'Tema', light: 'Açık', dark: 'Koyu', system: 'Sistem' },
    language: { heading: 'Dil' },
    help: { docs: 'Yardım', shortcuts: 'Kısayollar', feedback: 'Geri bildirim' },
  },
};

async function openMenu() {
  const utils = render(
    <NextIntlClientProvider locale="tr" messages={messages}>
      <UserMenu />
    </NextIntlClientProvider>,
  );
  await utils.user.click(screen.getByRole('button'));
  return utils;
}

describe('UserMenu', () => {
  it('shows the email in the dropdown header', async () => {
    await openMenu();
    expect(await screen.findByText('b@example.com')).toBeInTheDocument();
  });

  it('renders profile and settings items', async () => {
    await openMenu();
    expect(await screen.findByText('Profil')).toBeInTheDocument();
    expect(screen.getByText('Ayarlar')).toBeInTheDocument();
  });

  it('renders the theme segmented control with three options', async () => {
    await openMenu();
    expect(await screen.findByRole('radio', { name: 'Açık' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Koyu' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sistem' })).toBeInTheDocument();
  });

  it('renders the language segmented control with TR + EN', async () => {
    await openMenu();
    expect(await screen.findByRole('radio', { name: 'TR' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'EN' })).toBeInTheDocument();
  });

  it('renders the sign-out item', async () => {
    await openMenu();
    expect(await screen.findByText('Çıkış yap')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @pazarsync/web test:unit -- --run user-menu
```

Expected: assertion failures (current UserMenu only has email + sign out).

- [ ] **Step 3: Replace UserMenu**

```tsx
// apps/web/src/features/auth/components/user-menu.tsx
'use client';

import {
  ComputerIcon,
  HelpCircleIcon,
  Keyboard01Icon,
  Logout01Icon,
  MessageMultiple02Icon,
  Moon02Icon,
  Settings02Icon,
  Sun03Icon,
  UserIcon,
} from 'hugeicons-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useSignOut } from '@/features/auth/hooks/use-sign-out';
import { LOCALES, type Locale } from '@/i18n/config';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

export function UserMenu(): React.ReactElement {
  const t = useTranslations('userMenu');
  const tAuth = useTranslations('auth.userMenu');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();
  const { theme, setTheme } = useTheme();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  const handleLocaleChange = (next: string): void => {
    if (next === locale || !LOCALES.includes(next as Locale)) return;
    const queryString = searchParams.toString();
    const href = queryString ? `${pathname}?${queryString}` : pathname;
    startTransition(() => {
      router.replace(href, { locale: next as Locale });
    });
  };

  const initials = deriveInitials(user?.email ?? '?');
  // TODO(post-MVP): wire up user_metadata.full_name once sign-up captures it.
  const metadataFullName = user?.user_metadata?.full_name;
  const fullName = typeof metadataFullName === 'string' ? metadataFullName : undefined;

  return (
    <Popover>
      <PopoverTrigger
        className="flex size-9 items-center justify-center rounded-md focus-visible:outline-none"
        aria-label={t('open')}
      >
        <Avatar className="size-7">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-72 p-0">
        {user?.email !== undefined ? (
          <div className="gap-xs p-sm flex items-center">
            <Avatar className="size-9">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              {fullName ? (
                <span className="text-foreground truncate text-sm font-semibold">{fullName}</span>
              ) : null}
              <span className="text-muted-foreground truncate text-xs">{user.email}</span>
            </div>
          </div>
        ) : null}

        <Separator />

        <div className="gap-3xs p-2xs flex flex-col">
          <MenuLink href="/settings/profile" icon={UserIcon} label={t('profile')} />
          <MenuLink href="/settings" icon={Settings02Icon} label={t('settings')} />
        </div>

        <Separator />

        <div className="gap-xs p-sm flex flex-col">
          <SegmentLabel>{t('theme.heading')}</SegmentLabel>
          <ToggleGroup
            type="single"
            value={theme ?? 'system'}
            onValueChange={(v) => v && setTheme(v as 'light' | 'dark' | 'system')}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <ToggleGroupItem value="light" aria-label={t('theme.light')} className="gap-3xs flex-1">
              <Sun03Icon className="size-icon-sm" /> {t('theme.light')}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label={t('theme.dark')} className="gap-3xs flex-1">
              <Moon02Icon className="size-icon-sm" /> {t('theme.dark')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="system"
              aria-label={t('theme.system')}
              className="gap-3xs flex-1"
            >
              <ComputerIcon className="size-icon-sm" /> {t('theme.system')}
            </ToggleGroupItem>
          </ToggleGroup>

          <SegmentLabel>{t('language.heading')}</SegmentLabel>
          <ToggleGroup
            type="single"
            value={locale}
            onValueChange={handleLocaleChange}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {LOCALES.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                aria-label={option.toUpperCase()}
                className="flex-1 uppercase"
              >
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <Separator />

        <div className="gap-3xs p-2xs flex flex-col">
          <MenuLink href="/help" icon={HelpCircleIcon} label={t('help.docs')} />
          <MenuLink
            href="/help/shortcuts"
            icon={Keyboard01Icon}
            label={t('help.shortcuts')}
            kbd="⌘?"
          />
          <MenuLink href="/help/feedback" icon={MessageMultiple02Icon} label={t('help.feedback')} />
        </div>

        <Separator />

        <div className="p-2xs">
          <button
            type="button"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className={cn(
              'gap-xs px-xs py-3xs duration-fast flex w-full items-center rounded-md text-sm transition-colors',
              'text-destructive hover:bg-destructive-surface',
              'focus-visible:outline-none disabled:opacity-60',
            )}
          >
            <Logout01Icon className="size-icon-sm" />
            {tAuth('signOut')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SegmentLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
      {children}
    </span>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  kbd,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  kbd?: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={cn(
        'gap-xs px-xs py-3xs duration-fast flex items-center rounded-md text-sm transition-colors',
        'hover:bg-muted text-foreground',
        'focus-visible:outline-none',
      )}
    >
      <Icon className="size-icon-sm text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {kbd ? (
        <kbd className="text-2xs text-muted-foreground bg-muted px-3xs py-3xs rounded font-mono">
          {kbd}
        </kbd>
      ) : null}
    </Link>
  );
}

function deriveInitials(emailOrName: string): string {
  const base = emailOrName.split('@')[0] ?? '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
```

Notes:

- Uses `Popover` (not `DropdownMenu`) so we can host non-menuitem widgets (segmented toggles) inside.
- `ToggleGroup` (shadcn) renders radio-grouped toggles — accessible via `role="radio"` which our test asserts on.
- `useTheme()` from the project provider (`@/providers/theme-provider`); the showcase ThemeToggle confirms this is the right import path.

- [ ] **Step 4: Add i18n keys**

TR `userMenu`:

```json
"userMenu": {
  "open": "Kullanıcı menüsünü aç",
  "profile": "Profil",
  "settings": "Ayarlar",
  "theme": { "heading": "Tema", "light": "Açık", "dark": "Koyu", "system": "Sistem" },
  "language": { "heading": "Dil" },
  "help": {
    "docs": "Yardım & Dokümanlar",
    "shortcuts": "Klavye kısayolları",
    "feedback": "Geri bildirim"
  }
}
```

EN: "Open user menu", "Profile", "Settings", "Theme", "Light", "Dark", "System", "Language", "Help & Docs", "Keyboard shortcuts", "Send feedback".

- [ ] **Step 5: Run test, verify pass**

```bash
pnpm --filter @pazarsync/web test:unit -- --run user-menu
```

Expected: 5 tests pass.

- [ ] **Step 6: Visual check**

Refresh dev server, click user avatar in icon rail bottom. Expected: dropdown opens with header (initials + name + email), Profil/Ayarlar links, theme segmented toggle (Açık/Koyu/Sistem), language toggle (TR/EN), Help section, red Çıkış yap button. Toggling theme should immediately swap colors. Toggling language should redirect to `/{en|tr}/dashboard` preserving query.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/auth/components/user-menu.tsx \
        apps/web/tests/component/user-menu.test.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): expand UserMenu — theme + language + profile + help

Replaces the email-only DropdownMenu with a Popover containing a
header (avatar+name+email), Profile/Settings links, theme and
language segmented toggles, help links, and Sign Out. Removes the
need for the separate ContextRail bottom slot. Standalone
LanguageSwitcher and showcase ThemeToggle remain available for
landing-page use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Dashboard Body Rebuild

### Task 16: useDashboardMetrics hook + API placeholder

**Files:**

- Create: `apps/web/src/features/dashboard/api/dashboard.api.ts`
- Create: `apps/web/src/features/dashboard/hooks/use-dashboard-metrics.ts`
- Create: `apps/web/tests/unit/hooks/use-dashboard-metrics.test.ts`

The backend `/v1/organizations/{orgId}/stores/{storeId}/dashboard-metrics` endpoint does **not** exist yet. We define a stable frontend contract now and back it with a mock. The next backend plan will implement the real endpoint matching this shape.

- [ ] **Step 1: Define the contract + API wrapper**

```ts
// apps/web/src/features/dashboard/api/dashboard.api.ts
import Decimal from 'decimal.js';

import type { PeriodKey } from '@/features/dashboard/components/period-preset-list';

export interface DashboardKpis {
  revenue: Decimal;
  costedRevenue: Decimal;
  netProfit: Decimal;
  profitMarginPercent: number;
  returnCount: number;
  // YoY/PoP deltas in percent
  revenueDelta: number;
  costedRevenueDelta: number;
  netProfitDelta: number;
  profitMarginDeltaPoints: number;
  returnDelta: number;
}

export interface CostBreakdownEntry {
  key: 'product' | 'commission' | 'shipping' | 'service' | 'intl' | 'withholding' | 'vat' | 'other';
  amount: Decimal;
}

export interface DashboardTrendPoint {
  date: string; // ISO date
  profit: Decimal;
}

export interface FunnelStep {
  key: 'revenue' | 'minus-shipping' | 'minus-marketplace' | 'minus-cost' | 'net';
  amount: Decimal;
}

export interface ProductMetrics {
  netSales: number;
  avgProfit: Decimal;
  avgShippingCost: Decimal;
  avgCommissionPercent: number;
  avgDiscountPercent: number;
}

export interface OrderMetrics {
  count: number;
  avgOrderValue: Decimal;
  avgProfit: Decimal;
}

export interface ProductPerformance {
  id: string;
  name: string;
  delta: Decimal; // signed
}

export interface DashboardMetrics {
  kpis: DashboardKpis;
  costBreakdown: readonly CostBreakdownEntry[];
  profitTrend: readonly DashboardTrendPoint[];
  funnel: readonly FunnelStep[];
  productMetrics: ProductMetrics;
  orderMetrics: OrderMetrics;
  topProfitable: readonly ProductPerformance[];
  topLossy: readonly ProductPerformance[];
}

export interface DashboardMetricsParams {
  orgId: string;
  storeId: string;
  period: PeriodKey;
}

// MOCK — replace with apiClient.GET when backend endpoint ships.
export async function fetchDashboardMetrics(
  _params: DashboardMetricsParams,
): Promise<DashboardMetrics> {
  await new Promise((r) => setTimeout(r, 50));
  return MOCK_METRICS;
}

const MOCK_METRICS: DashboardMetrics = {
  kpis: {
    revenue: new Decimal('284390.45'),
    costedRevenue: new Decimal('192978.26'),
    netProfit: new Decimal('48120.80'),
    profitMarginPercent: 16.9,
    returnCount: 38,
    revenueDelta: 12.4,
    costedRevenueDelta: 9.8,
    netProfitDelta: 8.1,
    profitMarginDeltaPoints: 0.4,
    returnDelta: -14.2,
  },
  costBreakdown: [
    { key: 'product', amount: new Decimal('109798.45') },
    { key: 'commission', amount: new Decimal('34631.02') },
    { key: 'shipping', amount: new Decimal('20314.67') },
    { key: 'service', amount: new Decimal('2712.18') },
    { key: 'intl', amount: new Decimal('0') },
    { key: 'withholding', amount: new Decimal('1754.51') },
    { key: 'vat', amount: new Decimal('-2048.39') },
    { key: 'other', amount: new Decimal('3000') },
  ],
  profitTrend: [
    { date: '2026-04-15', profit: new Decimal('3105') },
    { date: '2026-04-16', profit: new Decimal('5621') },
    { date: '2026-04-17', profit: new Decimal('3609') },
    { date: '2026-04-18', profit: new Decimal('3290') },
    { date: '2026-04-19', profit: new Decimal('6125') },
    { date: '2026-04-20', profit: new Decimal('4220') },
    { date: '2026-04-21', profit: new Decimal('2480') },
  ],
  funnel: [
    { key: 'revenue', amount: new Decimal('192978.26') },
    { key: 'minus-shipping', amount: new Decimal('172663.59') },
    { key: 'minus-marketplace', amount: new Decimal('135320.39') },
    { key: 'minus-cost', amount: new Decimal('90000') },
    { key: 'net', amount: new Decimal('48120.80') },
  ],
  productMetrics: {
    netSales: 282,
    avgProfit: new Decimal('91.55'),
    avgShippingCost: new Decimal('72.04'),
    avgCommissionPercent: 17.95,
    avgDiscountPercent: 0.45,
  },
  orderMetrics: {
    count: 222,
    avgOrderValue: new Decimal('869.27'),
    avgProfit: new Decimal('116.29'),
  },
  topProfitable: [
    { id: 'p1', name: 'Kablosuz kulaklık', delta: new Decimal('8420') },
    { id: 'p2', name: 'Spor çanta', delta: new Decimal('6120') },
    { id: 'p3', name: 'Mutfak robotu', delta: new Decimal('4890') },
  ],
  topLossy: [
    { id: 'p4', name: 'Telefon kılıfı', delta: new Decimal('-342') },
    { id: 'p5', name: 'USB kablo', delta: new Decimal('-128') },
  ],
};
```

- [ ] **Step 2: Define the React Query hook + key factory**

```ts
// apps/web/src/features/dashboard/hooks/use-dashboard-metrics.ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchDashboardMetrics,
  type DashboardMetrics,
  type DashboardMetricsParams,
} from '@/features/dashboard/api/dashboard.api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (params: DashboardMetricsParams) => [...dashboardKeys.all, 'metrics', params] as const,
};

export function useDashboardMetrics(
  params: DashboardMetricsParams,
): UseQueryResult<DashboardMetrics> {
  return useQuery({
    queryKey: dashboardKeys.metrics(params),
    queryFn: () => fetchDashboardMetrics(params),
    enabled: Boolean(params.orgId && params.storeId),
  });
}
```

- [ ] **Step 3: Write hook test**

```ts
// apps/web/tests/unit/hooks/use-dashboard-metrics.test.ts
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { useDashboardMetrics } from '@/features/dashboard/hooks/use-dashboard-metrics';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDashboardMetrics', () => {
  it('returns metrics for a valid org/store/period', async () => {
    const { result } = renderHook(
      () => useDashboardMetrics({ orgId: 'o1', storeId: 's1', period: 'last-30d' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kpis.revenue.toString()).toBe('284390.45');
    expect(result.current.data?.costBreakdown).toHaveLength(8);
    expect(result.current.data?.funnel).toHaveLength(5);
  });

  it('does not fetch when storeId is empty', async () => {
    const { result } = renderHook(
      () => useDashboardMetrics({ orgId: 'o1', storeId: '', period: 'last-30d' }),
      { wrapper },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @pazarsync/web test:unit -- --run use-dashboard-metrics
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/dashboard/api/dashboard.api.ts \
        apps/web/src/features/dashboard/hooks/use-dashboard-metrics.ts \
        apps/web/tests/unit/hooks/use-dashboard-metrics.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add useDashboardMetrics hook with mock API

Defines the frontend contract for the upcoming
/v1/organizations/{orgId}/stores/{storeId}/dashboard-metrics
endpoint. KPIs, cost breakdown, profit trend, funnel, product /
order metric panels, top profitable / loss-making products. Backed
by an in-process mock until the backend ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Extend KpiTile with optional sparkline

**Files:**

- Modify: `apps/web/src/components/patterns/kpi-tile.tsx`

- [ ] **Step 1: Extend the props + render path**

Open `kpi-tile.tsx`. Replace the `KpiTileProps` interface and JSX:

```tsx
export interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value:
    | { kind: 'currency'; amount: Decimal | string | number }
    | { kind: 'count'; amount: number };
  delta?: { percent: number; goodDirection?: 'up' | 'down' };
  context?: string;
  wide?: boolean;
  /**
   * Optional sparkline points (0..1 normalised on Y, evenly spaced on X).
   * When provided, renders as a watermark behind the value at low opacity.
   */
  sparkline?: readonly number[];
  /** Sparkline tint — defaults to `--primary`. */
  sparklineTone?: 'primary' | 'success' | 'destructive' | 'info' | 'warning';
}
```

In the JSX, after the `<Card ... >` opening tag and before the existing children, add:

```tsx
{
  sparkline && sparkline.length > 1 ? (
    <Sparkline points={sparkline} tone={sparklineTone ?? 'primary'} />
  ) : null;
}
```

Then change the existing children wrappers to add `relative` so the absolute sparkline sits behind:

```tsx
<Card
  className={cn(
    'gap-md p-lg relative flex flex-col justify-between overflow-hidden',
    wide && 'sm:col-span-2',
    className,
  )}
  {...props}
>
  {sparkline && sparkline.length > 1 ? (
    <Sparkline points={sparkline} tone={sparklineTone ?? 'primary'} />
  ) : null}
  <div className="gap-md relative flex flex-col justify-between">
    {/* existing label + value + delta + context */}
  </div>
</Card>
```

Add the Sparkline helper at the bottom of the file:

```tsx
const TONE_COLOR: Record<NonNullable<KpiTileProps['sparklineTone']>, string> = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  destructive: 'var(--color-destructive)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
};

function Sparkline({
  points,
  tone,
}: {
  points: readonly number[];
  tone: NonNullable<KpiTileProps['sparklineTone']>;
}): React.ReactElement {
  const stroke = TONE_COLOR[tone];
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - p * 100;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="absolute inset-0 size-full opacity-15"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/patterns/kpi-tile.tsx
git commit -m "$(cat <<'EOF'
feat(web): add optional sparkline watermark to KpiTile

Backwards-compatible — KpiTile without `sparkline` renders
identically. With `sparkline` it paints a low-opacity SVG path
behind the value, à la Stripe / Mercury / Melontik tile design.
Tone defaults to primary; tones map to CSS color tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: CostBreakdownCard

**Files:**

- Create: `apps/web/src/features/dashboard/components/cost-breakdown-card.tsx`

- [ ] **Step 1: Implement using shadcn `chart` primitive**

```tsx
'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';
import { Cell, Pie, PieChart } from 'recharts';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { CostBreakdownEntry } from '@/features/dashboard/api/dashboard.api';

export interface CostBreakdownCardProps {
  entries: readonly CostBreakdownEntry[] | undefined;
}

const CATEGORY_KEY = {
  product: 'dashboard.cost.product',
  commission: 'dashboard.cost.commission',
  shipping: 'dashboard.cost.shipping',
  service: 'dashboard.cost.service',
  intl: 'dashboard.cost.intl',
  withholding: 'dashboard.cost.withholding',
  vat: 'dashboard.cost.vat',
  other: 'dashboard.cost.other',
} as const;

const CATEGORY_COLOR = {
  product: 'var(--chart-1)',
  commission: 'var(--chart-2)',
  shipping: 'var(--chart-3)',
  service: 'var(--chart-4)',
  intl: 'var(--chart-5)',
  withholding: 'var(--chart-6)',
  vat: 'var(--chart-7)',
  other: 'var(--chart-8)',
} as const;

export function CostBreakdownCard({ entries }: CostBreakdownCardProps): React.ReactElement {
  const t = useTranslations();
  const data = entries ?? [];

  const chartData = data
    .filter((e) => e.amount.gt(0))
    .map((e) => ({ key: e.key, amount: Number(e.amount.abs().toFixed(2)) }));

  const chartConfig = Object.fromEntries(
    data.map((e) => [e.key, { label: t(CATEGORY_KEY[e.key]), color: CATEGORY_COLOR[e.key] }]),
  ) satisfies ChartConfig;

  const total = data.reduce((sum, e) => sum.add(e.amount.abs()), new Decimal(0));

  return (
    <Card className="gap-lg p-lg flex flex-col">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-semibold">
          {t('dashboard.section.costBreakdown')}
        </h2>
        <span className="text-2xs text-muted-foreground tracking-wide uppercase">
          {t('dashboard.cost.total')}
          {' · '}
          <Currency value={total} className="font-semibold" />
        </span>
      </header>
      <div className="gap-lg grid grid-cols-1 items-center md:grid-cols-[200px_1fr]">
        <ChartContainer config={chartConfig} className="aspect-square w-full max-w-[200px]">
          <PieChart>
            <Pie data={chartData} dataKey="amount" nameKey="key" innerRadius={60} outerRadius={90}>
              {chartData.map((d) => (
                <Cell key={d.key} fill={CATEGORY_COLOR[d.key as keyof typeof CATEGORY_COLOR]} />
              ))}
            </Pie>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" />} />
          </PieChart>
        </ChartContainer>

        <div className="gap-md grid grid-cols-2 sm:grid-cols-4">
          {data.map((entry) => (
            <div key={entry.key} className="gap-3xs flex flex-col">
              <span
                className={cn(
                  'gap-3xs text-2xs text-muted-foreground flex items-center tracking-wide uppercase',
                )}
              >
                <span
                  className="size-2 rounded-sm"
                  style={{ backgroundColor: CATEGORY_COLOR[entry.key] }}
                />
                {t(CATEGORY_KEY[entry.key])}
              </span>
              <Currency value={entry.amount} className="text-foreground text-base font-semibold" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify chart token coverage**

```bash
grep -n "chart-[1-8]" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/app/tokens/colors.css
```

If `--chart-6/7/8` are missing (project may ship only 5 chart slots), add them to `apps/web/src/app/tokens/colors.css` in both `:root` and `.dark` blocks. Use OKLCH consistent with the existing palette — example values: `--chart-6: oklch(70% 0.10 220);`, `--chart-7: oklch(70% 0.06 50);`, `--chart-8: oklch(60% 0.04 280);`. Tweak by eye in the showcase.

- [ ] **Step 3: Add i18n keys**

TR `dashboard.cost`:

```json
"dashboard": {
  "section": { "costBreakdown": "Maliyet dağılımı" },
  "cost": {
    "total": "Toplam",
    "product": "Ürün maliyeti",
    "commission": "Komisyon",
    "shipping": "Kargo",
    "service": "Hizmet bedeli",
    "intl": "Uluslararası",
    "withholding": "Stopaj",
    "vat": "KDV",
    "other": "Diğer"
  }
}
```

EN: "Cost breakdown", "Total", "Product cost", "Commission", "Shipping", "Service fee", "International", "Withholding tax", "VAT", "Other".

- [ ] **Step 4: Type check**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: clean. If `Currency` doesn't accept a `className` prop, extend it (small one-line change in `patterns/currency.tsx` — `extends React.HTMLAttributes<HTMLSpanElement>`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/dashboard/components/cost-breakdown-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json \
        apps/web/src/app/tokens/colors.css \
        apps/web/src/components/patterns/currency.tsx
git commit -m "$(cat <<'EOF'
feat(web): add CostBreakdownCard for dashboard

Donut chart + 8-category legend (ürün maliyeti, komisyon, kargo,
hizmet bedeli, uluslararası, stopaj, KDV, diğer). Mirrors Melontik's
maliyet dağılımı pattern. Adds chart-6/7/8 tokens if absent so all
eight categories paint distinctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: ProfitTrendCard (line chart)

**Files:**

- Create: `apps/web/src/features/dashboard/components/profit-trend-card.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { DashboardTrendPoint } from '@/features/dashboard/api/dashboard.api';

export interface ProfitTrendCardProps {
  points: readonly DashboardTrendPoint[] | undefined;
}

const CONFIG = {
  profit: { label: 'Kâr', color: 'var(--color-success)' },
} satisfies ChartConfig;

export function ProfitTrendCard({ points }: ProfitTrendCardProps): React.ReactElement {
  const t = useTranslations();
  const formatter = useFormatter();
  const data = (points ?? []).map((p) => ({
    date: p.date,
    profit: Number(p.profit.toFixed(2)),
    label: formatter.dateTime(new Date(p.date), 'short'),
  }));

  return (
    <Card className="gap-md p-lg flex flex-col">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-semibold">
          {t('dashboard.section.profitTrend')}
        </h2>
      </header>
      <ChartContainer config={CONFIG} className="aspect-[16/8] w-full">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="profit-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="var(--color-success)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="var(--color-profit)"
            strokeWidth={2}
            fill="url(#profit-fill)"
          />
        </AreaChart>
      </ChartContainer>
    </Card>
  );
}
```

- [ ] **Step 2: Add i18n key**

TR: `dashboard.section.profitTrend`: "Kâr performansı"
EN: "Profit performance"

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/profit-trend-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add ProfitTrendCard (area line chart)

Area chart over the selected period. Stroke is the success token,
fill is a vertical gradient à la Stripe / Vercel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: NetProfitFunnelCard (custom SVG)

**Files:**

- Create: `apps/web/src/features/dashboard/components/net-profit-funnel-card.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import Decimal from 'decimal.js';
import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import type { FunnelStep } from '@/features/dashboard/api/dashboard.api';

export interface NetProfitFunnelCardProps {
  steps: readonly FunnelStep[] | undefined;
}

const STEP_LABEL_KEY = {
  revenue: 'dashboard.funnel.revenue',
  'minus-shipping': 'dashboard.funnel.minusShipping',
  'minus-marketplace': 'dashboard.funnel.minusMarketplace',
  'minus-cost': 'dashboard.funnel.minusCost',
  net: 'dashboard.funnel.net',
} as const;

const FILL = [
  'oklch(70% 0.18 145)',
  'oklch(75% 0.16 145)',
  'oklch(80% 0.13 145)',
  'oklch(85% 0.10 145)',
  'oklch(90% 0.06 145)',
];

export function NetProfitFunnelCard({ steps }: NetProfitFunnelCardProps): React.ReactElement {
  const t = useTranslations();
  const data = steps ?? [];
  if (data.length === 0) {
    return (
      <Card className="gap-md p-lg flex flex-col">
        <header className="flex items-center justify-between">
          <h2 className="text-foreground text-base font-semibold">
            {t('dashboard.section.funnel')}
          </h2>
        </header>
        <div className="text-muted-foreground py-lg text-center text-sm">—</div>
      </Card>
    );
  }
  const max = data.reduce((m, s) => (s.amount.gt(m) ? s.amount : m), new Decimal(0));
  const widths = data.map((s) => Number(s.amount.div(max).mul(100).toFixed(1)));

  return (
    <Card className="gap-md p-lg flex flex-col">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-semibold">{t('dashboard.section.funnel')}</h2>
      </header>
      <div className="gap-2xs flex flex-col">
        {data.map((step, i) => {
          const w = widths[i] ?? 0;
          const wNext = widths[i + 1] ?? w;
          const trapezoid = `polygon(${(100 - w) / 2}% 0, ${100 - (100 - w) / 2}% 0, ${100 - (100 - wNext) / 2}% 100%, ${(100 - wNext) / 2}% 100%)`;
          return (
            <div key={step.key} className="gap-md grid grid-cols-[1fr_140px] items-center">
              <div
                className="h-9"
                style={{
                  clipPath: trapezoid,
                  WebkitClipPath: trapezoid,
                  background: FILL[i] ?? FILL[FILL.length - 1],
                }}
                aria-hidden="true"
              />
              <div className="flex flex-col text-sm">
                <span className="text-muted-foreground text-2xs uppercase">
                  {t(STEP_LABEL_KEY[step.key])}
                </span>
                <Currency value={step.amount} className="text-foreground font-semibold" />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Add i18n keys**

TR `dashboard.funnel`: revenue "Ciro", minusShipping "Kargo düşüldü", minusMarketplace "Pazaryeri masrafı düşüldü", minusCost "Ürün maliyeti düşüldü", net "Net kâr". `dashboard.section.funnel`: "Net kâr funnel".
EN: "Revenue", "Less shipping", "Less marketplace fees", "Less product cost", "Net profit", "Net profit funnel".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/net-profit-funnel-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add NetProfitFunnelCard (custom CSS clip-path funnel)

5-step funnel from gross revenue to net profit. Each row is a
trapezoid drawn via clip-path so we don't need a charting funnel
plugin. Colors step from saturated success → muted to read as
"value drains".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: ProductMetricsCard + OrderMetricsCard

**Files:**

- Create: `apps/web/src/features/dashboard/components/product-metrics-card.tsx`
- Create: `apps/web/src/features/dashboard/components/order-metrics-card.tsx`

- [ ] **Step 1: Implement ProductMetricsCard**

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ProductMetrics } from '@/features/dashboard/api/dashboard.api';

export function ProductMetricsCard({
  data,
}: {
  data: ProductMetrics | undefined;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">
        {t('dashboard.section.productMetrics')}
      </h2>
      {data ? (
        <ul className="gap-2xs flex flex-col text-sm">
          <Row label={t('dashboard.product.netSales')} value={data.netSales.toString()} />
          <Separator />
          <Row
            label={t('dashboard.product.avgProfit')}
            value={<Currency value={data.avgProfit} />}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgShipping')}
            value={<Currency value={data.avgShippingCost} />}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgCommission')}
            value={`%${data.avgCommissionPercent.toFixed(2)}`}
          />
          <Separator />
          <Row
            label={t('dashboard.product.avgDiscount')}
            value={`%${data.avgDiscountPercent.toFixed(2)}`}
          />
        </ul>
      ) : (
        <div className="text-muted-foreground text-center text-sm">—</div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </li>
  );
}
```

- [ ] **Step 2: Implement OrderMetricsCard**

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { OrderMetrics } from '@/features/dashboard/api/dashboard.api';

export function OrderMetricsCard({ data }: { data: OrderMetrics | undefined }): React.ReactElement {
  const t = useTranslations();
  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">
        {t('dashboard.section.orderMetrics')}
      </h2>
      {data ? (
        <ul className="gap-2xs flex flex-col text-sm">
          <Row label={t('dashboard.order.count')} value={data.count.toString()} />
          <Separator />
          <Row
            label={t('dashboard.order.avgValue')}
            value={<Currency value={data.avgOrderValue} />}
          />
          <Separator />
          <Row label={t('dashboard.order.avgProfit')} value={<Currency value={data.avgProfit} />} />
        </ul>
      ) : (
        <div className="text-muted-foreground text-center text-sm">—</div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </li>
  );
}
```

- [ ] **Step 3: Add i18n keys**

TR:

```json
"dashboard": {
  "section": { "productMetrics": "Ürün metrikleri", "orderMetrics": "Sipariş metrikleri" },
  "product": {
    "netSales": "Net satış",
    "avgProfit": "Ortalama kâr",
    "avgShipping": "Ortalama kargo",
    "avgCommission": "Ortalama komisyon",
    "avgDiscount": "Ortalama indirim"
  },
  "order": { "count": "Sipariş", "avgValue": "Ortalama satış", "avgProfit": "Ortalama kâr" }
}
```

EN equivalents: "Product metrics", "Order metrics", "Net sales", "Avg profit", "Avg shipping", "Avg commission", "Avg discount", "Orders", "Avg order value", "Avg profit".

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/dashboard/components/product-metrics-card.tsx \
        apps/web/src/features/dashboard/components/order-metrics-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add ProductMetricsCard + OrderMetricsCard

Right-rail vertical metric panels paired with the trend chart and
funnel in the dashboard body. Both render dashes when data is
loading.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: TopProductsCard (parametric: profitable / loss-making)

**Files:**

- Create: `apps/web/src/features/dashboard/components/top-products-card.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useTranslations } from 'next-intl';

import { Currency } from '@/components/patterns/currency';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProductPerformance } from '@/features/dashboard/api/dashboard.api';

export interface TopProductsCardProps {
  variant: 'profitable' | 'lossy';
  products: readonly ProductPerformance[] | undefined;
}

export function TopProductsCard({ variant, products }: TopProductsCardProps): React.ReactElement {
  const t = useTranslations();
  const titleKey =
    variant === 'profitable' ? 'dashboard.section.topProfitable' : 'dashboard.section.topLossy';
  const tone = variant === 'profitable' ? 'text-success' : 'text-destructive';
  return (
    <Card className="gap-md p-lg flex flex-col">
      <h2 className="text-foreground text-base font-semibold">{t(titleKey)}</h2>
      {!products || products.length === 0 ? (
        <div className="text-muted-foreground py-md text-center text-sm">—</div>
      ) : (
        <ul className="gap-3xs flex flex-col text-sm">
          {products.map((p) => (
            <li
              key={p.id}
              className="border-border py-xs flex items-center justify-between border-b last:border-b-0"
            >
              <span className="text-foreground truncate">{p.name}</span>
              <Currency value={p.delta} className={cn('font-semibold', tone)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Add i18n keys**

TR: `dashboard.section.topProfitable` "En karlı ürünler", `dashboard.section.topLossy` "Zararlı ürünler".
EN: "Top profitable products", "Loss-making products".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/top-products-card.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add TopProductsCard (profitable/lossy variant)

Single component, two configurations — green deltas for profitable
products, red for loss-makers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Assemble Dashboard page

**Files:**

- Modify: `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Replace the page**

```tsx
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge } from '@/components/patterns/sync-badge';
import { NotificationBell } from '@/components/patterns/notification-bell';
import { ActiveOrganizationPanel } from '@/features/organization/components/active-organization-panel';
import { StoresPanel } from '@/features/stores/components/stores-panel';
import { DashboardBody } from '@/features/dashboard/components/dashboard-body';
import type { Organization } from '@/features/organization/api/organizations.api';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';

export const metadata = {
  title: 'Gösterge paneli',
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;

  const api = await getServerApiClient();
  const [orgsResult, meResult] = await Promise.all([
    api.GET('/v1/organizations', {}),
    api.GET('/v1/me', {}),
  ]);

  const orgs: Organization[] = orgsResult.data?.data ?? [];
  if (orgsResult.data !== undefined && orgs.length === 0) {
    redirect('/onboarding/create-organization');
  }

  const activeOrgId = await resolveActiveOrgId(orgs);
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const viewerTimezone = meResult.data?.timezone;

  return (
    <>
      <PageHeader
        title="Gösterge paneli"
        intent={activeOrg ? `${activeOrg.name} · Trendyol TR` : undefined}
        meta={<SyncBadge state="fresh" lastSyncedAt={new Date()} source="Trendyol" />}
        actions={<NotificationBell entries={[]} unreadCount={0} />}
      />
      {activeOrg ? (
        <>
          <ActiveOrganizationPanel
            org={activeOrg}
            locale={locale}
            viewerTimezone={viewerTimezone}
          />
          <StoresPanel orgId={activeOrg.id} />
          <DashboardBody orgId={activeOrg.id} storeId={/* see Step 2 */ ''} />
        </>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Decide active store source**

The dashboard's body is store-scoped. The active store id lives in a cookie set by `/lib/active-store` (assume it exists; if not, mirror `resolveActiveOrgId`). Server-side: read it; if absent, render an EmptyState directing the user to connect a store via `StoresPanel`.

For this task pick whichever exists in the codebase (`grep -rn "activeStoreId" apps/web/src/lib`). If neither exists, defer rendering `<DashboardBody>` with a TODO comment for the next iteration. **Don't ship a hard-coded store id.**

- [ ] **Step 3: Implement DashboardBody composite**

Create `apps/web/src/features/dashboard/components/dashboard-body.tsx`:

```tsx
'use client';

import { parseAsStringEnum, useQueryState } from 'nuqs';
import * as React from 'react';

import { KpiTile } from '@/components/patterns/kpi-tile';
import { StatGroup } from '@/components/patterns/stat-group';
import { CostBreakdownCard } from '@/features/dashboard/components/cost-breakdown-card';
import { NetProfitFunnelCard } from '@/features/dashboard/components/net-profit-funnel-card';
import { OrderMetricsCard } from '@/features/dashboard/components/order-metrics-card';
import { PERIOD_PRESETS, type PeriodKey } from '@/features/dashboard/components/period-preset-list';
import { ProductMetricsCard } from '@/features/dashboard/components/product-metrics-card';
import { ProfitTrendCard } from '@/features/dashboard/components/profit-trend-card';
import { TopProductsCard } from '@/features/dashboard/components/top-products-card';
import { useDashboardMetrics } from '@/features/dashboard/hooks/use-dashboard-metrics';

const PERIOD_KEYS = PERIOD_PRESETS.map((p) => p.key);

export function DashboardBody({
  orgId,
  storeId,
}: {
  orgId: string;
  storeId: string;
}): React.ReactElement {
  const [period] = useQueryState(
    'period',
    parseAsStringEnum<PeriodKey>(PERIOD_KEYS).withDefault('last-30d'),
  );
  const { data } = useDashboardMetrics({ orgId, storeId, period });

  const trendPoints = (data?.profitTrend ?? []).map((p) => Number(p.profit));

  return (
    <>
      <StatGroup>
        <KpiTile
          label="Ciro"
          value={{ kind: 'currency', amount: data?.kpis.revenue ?? '0' }}
          delta={data ? { percent: data.kpis.revenueDelta, goodDirection: 'up' } : undefined}
          sparkline={normalize(trendPoints)}
          sparklineTone="primary"
        />
        <KpiTile
          label="Maliyetli ciro"
          value={{ kind: 'currency', amount: data?.kpis.costedRevenue ?? '0' }}
          delta={data ? { percent: data.kpis.costedRevenueDelta, goodDirection: 'up' } : undefined}
          sparkline={normalize(trendPoints)}
        />
        <KpiTile
          label="Net kâr"
          value={{ kind: 'currency', amount: data?.kpis.netProfit ?? '0' }}
          delta={data ? { percent: data.kpis.netProfitDelta, goodDirection: 'up' } : undefined}
          sparkline={normalize(trendPoints)}
          sparklineTone="success"
        />
        <KpiTile
          label="Kâr/Satış"
          value={{
            kind: 'count',
            amount: Math.round((data?.kpis.profitMarginPercent ?? 0) * 10) / 10,
          }}
          delta={
            data ? { percent: data.kpis.profitMarginDeltaPoints, goodDirection: 'up' } : undefined
          }
        />
        <KpiTile
          label="İade"
          value={{ kind: 'count', amount: data?.kpis.returnCount ?? 0 }}
          delta={data ? { percent: data.kpis.returnDelta, goodDirection: 'down' } : undefined}
          sparkline={normalize(trendPoints)}
          sparklineTone="warning"
        />
      </StatGroup>

      <CostBreakdownCard entries={data?.costBreakdown} />

      <div className="gap-lg grid grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfitTrendCard points={data?.profitTrend} />
        </div>
        <ProductMetricsCard data={data?.productMetrics} />
      </div>

      <div className="gap-lg grid grid-cols-1 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NetProfitFunnelCard steps={data?.funnel} />
        </div>
        <OrderMetricsCard data={data?.orderMetrics} />
      </div>

      <div className="gap-lg grid grid-cols-1 md:grid-cols-2">
        <TopProductsCard variant="profitable" products={data?.topProfitable} />
        <TopProductsCard variant="lossy" products={data?.topLossy} />
      </div>
    </>
  );
}

function normalize(points: readonly number[]): readonly number[] {
  if (points.length === 0) return points;
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return points.map(() => 0.5);
  return points.map((p) => (p - min) / (max - min));
}
```

`StatGroup` may currently render only 4 columns. Update its grid to support the 5-tile case if needed (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`). Touch with care — verify `wide` prop still spans correctly.

- [ ] **Step 4: Update StatGroup if necessary**

```bash
grep -n "grid-cols" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/components/patterns/stat-group.tsx
```

Adjust to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` (or accept a `cols` prop).

- [ ] **Step 5: Visual check**

Refresh dev server. Expected: dashboard shows 5 KPI tiles with sparkline backgrounds, cost donut + 8 categories, line chart + product metrics, funnel + order metrics, two product lists (profitable + lossy). Mock data for now.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/[locale]/\(dashboard\)/dashboard/page.tsx \
        apps/web/src/features/dashboard/components/dashboard-body.tsx \
        apps/web/src/components/patterns/stat-group.tsx
git commit -m "$(cat <<'EOF'
feat(web): rebuild Dashboard body — Melontik-tier density

5 sparkline KPI tiles → cost breakdown donut → profit trend +
product metrics → funnel + order metrics → top profitable / lossy
products. Hooks into useDashboardMetrics with the active store and
URL-bound period.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Mobile Responsive

### Task 24: MobileTopBar component

**Files:**

- Create: `apps/web/src/components/layout/mobile-top-bar.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client';

import { Menu01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/wordmark';
import { UserMenu } from '@/features/auth/components/user-menu';
import { Link } from '@/i18n/navigation';

export interface MobileTopBarProps {
  onOpenNav: () => void;
  trailing?: React.ReactNode; // e.g. NotificationBell
}

/**
 * Visible only below md. Hosts the hamburger trigger (opens
 * MobileNavSheet) plus brand logo, optional trailing action
 * (notification bell), and the user menu.
 */
export function MobileTopBar({ onOpenNav, trailing }: MobileTopBarProps): React.ReactElement {
  const t = useTranslations('mobileTopBar');
  return (
    <header className="border-border bg-background gap-xs px-sm py-xs flex h-12 items-center justify-between border-b md:hidden">
      <div className="gap-xs flex items-center">
        <Button variant="ghost" size="icon-sm" onClick={onOpenNav} aria-label={t('openNav')}>
          <Menu01Icon className="size-icon-sm" />
        </Button>
        <Link href="/dashboard" aria-label={t('home')}>
          <Wordmark withText={false} />
        </Link>
      </div>
      <div className="gap-xs flex items-center">
        {trailing}
        <UserMenu />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: i18n keys**

TR `mobileTopBar`: openNav "Menüyü aç", home "Ana sayfa".
EN: "Open menu", "Home".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/mobile-top-bar.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add MobileTopBar (hamburger + bell + user menu)

Mobile-only top bar that hosts the hamburger trigger for
MobileNavSheet, brand link, optional trailing slot (bell), and the
user menu. Hidden on md+ where the IconRail+ContextRail handle
this.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: MobileNavSheet

**Files:**

- Create: `apps/web/src/components/layout/mobile-nav-sheet.tsx`
- Create: `apps/web/tests/component/mobile-nav-sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/component/mobile-nav-sheet.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import { MobileNavSheet } from '@/components/layout/mobile-nav-sheet';
import { render, screen } from '@/../tests/helpers/render';

vi.mock('@/i18n/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/navigation')>();
  return {
    ...actual,
    usePathname: () => '/orders',
    Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  };
});

const messages = {
  mobileNavSheet: { title: 'Menü', close: 'Kapat' },
  contextRail: { ariaLabel: 'Context rail' },
  iconRail: { ariaLabel: 'Icon rail', brandAriaLabel: 'PazarSync' },
  nav: {
    dashboard: 'Pano',
    orders: 'Siparişler',
    products: 'Ürünler',
    profitability: 'Kârlılık',
    reconciliation: 'Mutabakat',
    expenses: 'Giderler',
    settings: 'Ayarlar',
  },
  navSections: {
    orders: {
      status: {
        title: 'Durum',
        all: 'Tümü',
        pending: 'Bekleyen',
        shipped: 'Kargoda',
        delivered: 'Teslim',
        returned: 'İade',
      },
    },
  },
  storeSwitcher: {
    searchPlaceholder: 'Ara',
    empty: '—',
    heading: 'Mağazalar',
    active: 'aktif',
    addStore: 'Yeni mağaza',
  },
};

describe('MobileNavSheet', () => {
  it('renders nav links and the page-specific sub-nav when open', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <MobileNavSheet
          open
          onOpenChange={() => {}}
          stores={[{ id: 's1', name: 'Trendyol TR', platform: 'TRENDYOL', status: 'active' }]}
          activeStoreId="s1"
          onSelectStore={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Pano' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Siparişler' })).toBeInTheDocument();
    expect(screen.getByText('Durum')).toBeInTheDocument(); // sub-nav for /orders
  });

  it('does not render when closed', () => {
    render(
      <NextIntlClientProvider locale="tr" messages={messages}>
        <MobileNavSheet
          open={false}
          onOpenChange={() => {}}
          stores={[]}
          activeStoreId=""
          onSelectStore={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('link', { name: 'Pano' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, fail**

```bash
pnpm --filter @pazarsync/web test:unit -- --run mobile-nav-sheet
```

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/layout/mobile-nav-sheet.tsx
'use client';

import { useTranslations } from 'next-intl';

import { NAV_ITEMS, type NavItem } from '@/components/layout/nav-config';
import { StoreSwitcher, type Store } from '@/components/layout/store-switcher';
import { SubNavList } from '@/components/patterns/sub-nav-list';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface MobileNavSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: Store[];
  activeStoreId: string;
  onSelectStore: (id: string) => void;
  onAddStore?: () => void;
}

export function MobileNavSheet({
  open,
  onOpenChange,
  stores,
  activeStoreId,
  onSelectStore,
  onAddStore,
}: MobileNavSheetProps): React.ReactElement {
  const t = useTranslations();
  const tSheet = useTranslations('mobileNavSheet');
  const pathname = usePathname();

  const activeItem: NavItem | undefined = NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-sm">
          <SheetTitle>{tSheet('title')}</SheetTitle>
        </SheetHeader>

        {stores.length > 0 ? (
          <div className="px-sm pb-sm">
            <StoreSwitcher
              stores={stores}
              activeStoreId={activeStoreId}
              onSelect={(id) => {
                onSelectStore(id);
                onOpenChange(false);
              }}
              onAddStore={onAddStore}
            />
          </div>
        ) : null}

        <nav className="px-sm gap-3xs flex flex-col">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  'gap-xs px-xs py-xs duration-fast flex items-center rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  isActive ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-icon-sm" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        {activeItem && 'sections' in activeItem && activeItem.sections ? (
          <div className="px-sm py-md gap-md flex flex-col border-t">
            {activeItem.sections.map((section) => (
              <SubNavList
                key={section.key}
                headingKey={section.labelKey}
                currentHref={pathname}
                items={section.items}
              />
            ))}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: i18n keys**

TR `mobileNavSheet`: title "Menü", close "Kapat".
EN: "Menu", "Close".

- [ ] **Step 5: Run test**

```bash
pnpm --filter @pazarsync/web test:unit -- --run mobile-nav-sheet
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/mobile-nav-sheet.tsx \
        apps/web/tests/component/mobile-nav-sheet.test.tsx \
        apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(web): add MobileNavSheet (drawer for nav + sub-nav + store)

Slide-over sheet that hosts nav items + page sub-nav + the store
switcher when below md. Triggered by the MobileTopBar hamburger.
Re-uses SubNavList so the per-page sub-nav looks identical to
desktop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: Wire Mobile shell into AppShell

**Files:**

- Modify: `apps/web/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Add mobile state + render**

Edit `app-shell.tsx`. Add `import * as React from 'react';` if missing, then add `MobileTopBar` and `MobileNavSheet` imports. Replace the `AppShell` body:

```tsx
'use client';

import * as React from 'react';

import { ContextRail } from '@/components/layout/context-rail';
import { IconRail } from '@/components/layout/icon-rail';
import { MobileNavSheet } from '@/components/layout/mobile-nav-sheet';
import { MobileTopBar } from '@/components/layout/mobile-top-bar';
import { type Store } from '@/components/layout/store-switcher';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  orgSwitcher?: React.ReactNode;
  stores?: Store[];
  activeStoreId?: string;
  onSelectStore?: (id: string) => void;
  onAddStore?: () => void;
  children: React.ReactNode;
}

export function AppShell({
  orgSwitcher,
  stores = [],
  activeStoreId,
  onSelectStore,
  onAddStore,
  children,
}: AppShellProps): React.ReactElement {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="bg-background text-foreground flex h-full flex-col overflow-hidden md:grid md:grid-cols-[auto_auto_1fr] md:grid-rows-1">
      <MobileTopBar onOpenNav={() => setMobileNavOpen(true)} />
      <MobileNavSheet
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        stores={stores}
        activeStoreId={activeStoreId ?? ''}
        onSelectStore={onSelectStore ?? (() => undefined)}
        onAddStore={onAddStore}
      />

      <div className="hidden md:block">
        <IconRail />
      </div>
      <div className="hidden md:block">
        <ContextRail
          orgSwitcher={orgSwitcher}
          stores={stores}
          activeStoreId={activeStoreId ?? ''}
          onSelectStore={onSelectStore ?? (() => undefined)}
          onAddStore={onAddStore}
        />
      </div>

      <main
        id="main"
        className={cn('relative min-w-0 flex-1 overflow-y-auto', 'focus-visible:outline-none')}
      >
        <div className="max-w-content-max gap-lg px-sm py-sm md:px-lg md:py-lg mx-auto flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
```

Note: outer container is `flex flex-col` on mobile (top bar + main stacked) and `md:grid` for desktop.

- [ ] **Step 2: Visual check (mobile viewport)**

In dev tools, set viewport to 375×812 (iPhone). Refresh `/tr/dashboard`. Expected:

- IconRail + ContextRail hidden
- MobileTopBar visible at top with hamburger + bell (rendered by PageHeader actions inside main) + user menu
- Main fills width
- KPI grid → 1 column

Hamburger click → MobileNavSheet slides in from left with nav items + sub-nav (currently dashboard has no sub-nav, so just the nav).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/app-shell.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire MobileTopBar + MobileNavSheet into AppShell

Below md, IconRail + ContextRail hide; MobileTopBar takes the top
slot and the user opens MobileNavSheet via hamburger. Above md the
old grid is preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: KPI grid + body breakpoint verification

**Files:** none new (verification + small tweaks)

- [ ] **Step 1: Verify dashboard body grids on mobile**

Visit `/tr/dashboard` at 375px width. Expected:

- KPI grid: single column
- CostBreakdownCard donut + legend stack vertically (legend → 2 cols)
- ProfitTrendCard, NetProfitFunnelCard occupy full width
- ProductMetricsCard, OrderMetricsCard stack below their charts
- TopProductsCard pair stacks vertically

If any section overflows or columns break: fix the breakpoint classes (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` style; replace ad-hoc `md:grid-cols-N` if needed). Commit per fix.

- [ ] **Step 2: Verify touch target sizes per CLAUDE.md (`pointer-coarse:size-11`)**

```bash
grep -rn "pointer-coarse" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src
```

Likely zero hits — Tailwind variant may not be configured. If you intend this rule, add the variant config to `apps/web/tailwind.config.ts` (or wherever Tailwind config lives). For this plan we leave the rule advisory; add it as part of a follow-up "mobile polish" plan rather than expanding scope here.

- [ ] **Step 3: Commit fixes (if any)**

```bash
git add ...
git commit -m "$(cat <<'EOF'
fix(web): tighten dashboard body breakpoints for mobile

[describe specific tweaks made during step 1]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Cleanup + Verification

### Task 28: Update layout-demo showcase

**Files:**

- Modify: `apps/web/src/app/[locale]/(showcase)/design/layout-demo/page.tsx`

- [ ] **Step 1: Read current file**

```bash
cat /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/src/app/[locale]/\(showcase\)/design/layout-demo/page.tsx
```

- [ ] **Step 2: Remove `activity` prop usage and update to 3-col**

Strip any `activity={MOCK_ACTIVITY}` prop and any imports of `MOCK_ACTIVITY` from the showcase mocks. The showcase should now demonstrate the 3-col shell with nav + sub-nav + main content. Add a brief note in the page intent: "3-col shell · activity rail removed in Apr 2026".

- [ ] **Step 3: Visual check**

Open `/tr/design/layout-demo`. Expected: 3 columns, no right rail, nav + store switcher visible, body shows demo content.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/[locale]/\(showcase\)/design/layout-demo/page.tsx \
        apps/web/src/components/showcase/showcase-mocks.ts
git commit -m "$(cat <<'EOF'
chore(web): update layout-demo to reflect 3-col shell

Drops the activity prop and any MOCK_ACTIVITY references; updates
the page intent so future onboarders see the current architecture.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 29: i18n key audit (TR + EN parity)

**Files:**

- Modify: `apps/web/messages/tr.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Diff key sets**

```bash
node -e "
const tr = require('/Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/tr.json');
const en = require('/Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/en.json');
function flatten(o, prefix='') {
  return Object.entries(o).flatMap(([k,v]) => {
    const key = prefix ? prefix+'.'+k : k;
    return typeof v === 'object' && v !== null ? flatten(v, key) : [key];
  });
}
const trKeys = new Set(flatten(tr));
const enKeys = new Set(flatten(en));
const onlyTr = [...trKeys].filter(k => !enKeys.has(k));
const onlyEn = [...enKeys].filter(k => !trKeys.has(k));
console.log('Only in TR:'); onlyTr.forEach(k => console.log(' ', k));
console.log('Only in EN:'); onlyEn.forEach(k => console.log(' ', k));
"
```

- [ ] **Step 2: Add missing translations to bring both files into parity**

Mirror any missing key. Translate sensibly — Turkish first (it's the canonical UX), then English.

- [ ] **Step 3: Verify no `activityRail.*` remain**

```bash
grep -n "activityRail" /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/tr.json /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web/messages/en.json
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
chore(web): bring TR/EN message catalogs to parity

Adds missing keys uncovered during the dashboard shell rewrite,
removes any orphaned activityRail entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 30: Final pre-PR check

**Files:** none

- [ ] **Step 0: Doc-language sweep**

The shell architecture changed (no more "dual-rail"). Search and update stale references:

```
grep -rn "dual-rail\|dual rail" apps/web/src apps/web/CLAUDE.md
```

For each hit, change "dual-rail AppShell" → "three-column AppShell" (or similar). Don't change `apps/web/CLAUDE.md` if the change is in a code-fence example that intentionally reflects the old architecture.

- [ ] **Step 1: Run the full check suite**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
pnpm check:all
```

Expected: typecheck + lint + unit tests + format check all green. Fix every error before continuing.

- [ ] **Step 2: Manual smoke (browser)**

Visit each in dev server and confirm no console errors:

- `/tr/dashboard` — full body, rail, bell popover, period preset switching changes URL
- `/tr/orders` — sub-nav visible (5 status presets)
- `/tr/products` — sub-nav visible (catalog 5 items + meta 1 item)
- `/tr/profitability` — sub-nav visible (5 reports)
- `/tr/reconciliation` — sub-nav (3 statuses, mismatch warning tone)
- `/tr/expenses` — sub-nav (5 categories)
- `/tr/settings` — sub-nav (5 sections)
- `/tr/notifications` — empty state placeholder
- `/en/dashboard` — same shell, English labels via UserMenu language toggle
- Mobile viewport (375×812) — top bar + drawer
- Dark mode via UserMenu — palette swaps cleanly

- [ ] **Step 3: Push branch (NO PR yet — keep open for stacked work)**

```bash
git push -u origin feature/dashboard-shell-redesign
```

(no `gh pr create` — user said features land in batched commits; PR opens when feature surface is ready for review)

- [ ] **Step 4: Mark plan complete**

This plan finishes when Step 3 succeeds. Open follow-up plans (backend `/dashboard-metrics` endpoint, /notifications real feed, mobile polish) as separate specs.

---

## Self-Review Checklist (already done by author)

Spec coverage:

- [x] Activity rail removal (Tasks 2, 3, 28)
- [x] AppShell 3-col (Task 3)
- [x] NotificationBell + PageHeader (Tasks 4, 5)
- [x] /notifications placeholder (Task 6)
- [x] SubNavList pattern + nav-config extension (Tasks 7, 8)
- [x] ContextRail middle per-page + bottom removal (Task 9)
- [x] StoreSwitcher prominence (Task 10)
- [x] Dashboard rail content — store summary + period presets + warning (Tasks 11–14)
- [x] UserMenu — header + theme + lang + profile + help + logout (Task 15)
- [x] Dashboard body — hook + 7 components + assembly (Tasks 16–23)
- [x] Mobile responsive — top bar + sheet + AppShell wiring (Tasks 24–27)
- [x] Cleanup — showcase + i18n audit + final check (Tasks 28–30)

Type consistency:

- `PeriodKey` defined in `period-preset-list.tsx`, re-imported by `dashboard.api.ts` and `dashboard-body.tsx` — same identifier throughout.
- `Store` from `store-switcher.tsx` reused by ContextRail, AppShell, MobileNavSheet.
- `NavItem` discriminated union with `meta: 'dashboard'` consistently used.
- `DashboardMetrics`, `CostBreakdownEntry`, `FunnelStep`, `ProductMetrics`, `OrderMetrics`, `ProductPerformance` defined once in `dashboard.api.ts`, consumed by hook + components.

Placeholder scan:

- All steps contain real code or real commands.
- "TODO" appears once (Task 23 Step 2) where the active store id source is conditional on existing infra — paired with explicit instruction not to ship a hard-coded id.

---

## Execution Notes

- Total tasks: **30** across 6 phases.
- TDD applied to all interactive components (NotificationBell, SubNavList, ContextRail, PeriodPresetList, UserMenu, MobileNavSheet) and the hook (useDashboardMetrics).
- Pure presentational components (cards) ship without component tests per CLAUDE.md guidance — covered indirectly by the dashboard page render.
- Commits per task. Phase 1 Task 3 commit bundles the spec doc per user's "no doc-only commits" rule.
- Multi-tenancy isolation tests not required this plan — no new backend endpoints. The eventual `/dashboard-metrics` endpoint must include one per CLAUDE.md non-negotiable.
