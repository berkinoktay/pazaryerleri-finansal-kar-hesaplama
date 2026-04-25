# Dashboard Shell — Tek Sidebar Design

**Date:** 2026-04-25
**Branch:** `feature/dashboard-shell-redesign`
**Status:** Approved by Berkin (owner) — ready for implementation planning
**Brainstorm artifacts:** `.superpowers/brainstorm/91783-1777121849/content/*.html` (gitignored, kept for reference until next session purge)

---

## 1. Decision Summary

PazarSync'in dashboard shell'i mevcut **3-rail (IconRail + ContextRail + Main)** mimarisinden **Tek Sidebar (collapsible 290px ↔ 48px) + 1fr Main** mimarisine geçer. Sidebar Tiyasis/Linear/Notion paterninde nested feature gruplarını inline expandable olarak taşır; bottom dock'ta utility cluster (Destek · Ayarlar · Tema · User+Trial+⋮) sticky kalır. Org+store switcher sidebar header'ında kombine bir chip; tıklanınca iki seksiyonlu (Organizasyonlar + Mağazalar) layered dropdown açılır. Settings kendi internal layout'u (secondary sidebar) ile ana shell'i kirletmez. Eski Context Rail'in sayfa-spesifik içerikleri (warning kartları, date range chips, saved views, recent items, bulk actions) page-level UI'ye iner.

İmplementation `shadcn/ui` `Sidebar` primitive (registry'den eklenecek) üzerine inşa edilir, mevcut tüm OKLCH palette / Host Grotesk / `--space-*` / `--shadow-*` tokenları korunur — yeni palette eklenmez.

---

## 2. Context

Mevcut shell `feature/dashboard-shell-redesign` dalında shipping: 48px IconRail + 220px ContextRail + 1fr Main, mobile için MobileTopBar + MobileNavSheet. Dashboard'da `DashboardContextMiddle` ile pano kartları, diğer sayfalarda `SubNavList` ile sub-nav. Bu shell çalışıyor ama iki temel kısıtla karşılaştık:

1. **Sub-nav modeli yetersiz** — mevcut `nav-config.ts` `sections.items` yapısı sayfa içi URL filter chip'leri için tasarlanmış (Orders → Bekleyen/Kargoda); rakiplerin (Tiyasis, ve diğer Türk pazaryeri analiz tool'ları) gerçekten kullandığı pattern <em>nested feature grupları</em> (Karlılık Analizi → 5 ayrı route, Maliyet & Araçlar → 4 ayrı route). Mevcut shape bu paterne kıvrak olmadan sığmıyor.
2. **Context Rail'in dolup taşmasını yönetme zorluğu** — operasyonel sayfalarda (Dashboard, Orders, Products, Profitability) zengin içerik üretebiliyor ama Settings/Notifications gibi düşük-frekans sayfalarda boşa düşüyor. Sayfa-bazlı opt-in tasarım emeği gerektiriyor; rakiplerin tek-sidebar'a koyduğu içerikleri (warning kartları, date range, saved views) sidebar'da değil page-toolbar'da tutmak daha dürüst.

Brainstorm sürecinde 5 alternatif shell incelendi (3-Rail / Tek Sidebar / Hibrit Top+3-Rail / Top+Side / Top-only); Berkin top-bar varyantlarını eledi (`top-bar nav istemiyorum`); ardından sub-nav modeli düzeltildi (URL filter → nested route gruplar) ve Tek Sidebar'ın multi-group-expand özelliği nested nav için doğal seçim oldu. Tüm karar nesli `.superpowers/brainstorm/91783-1777121849/content/` altındaki HTML wireframe'lerde belgelendi.

---

## 3. Out of Scope

Bu spec **shell mimarisini ve org-store switcher tasarımını** kilitler. Aşağıdakiler bu spec'in dışındadır ve ayrı tasarım/implementasyon dokümanları ister:

- **Sayfa içerikleri** — KPI grid'ler, chart'lar, tablolar, page-spesifik toolbar component'leri (her sayfa için). Brainstorm'da örnek olarak çizildi ama bu spec'in scope'unda değil.
- **Davet flow'u (organization invitations)** — Kabul/red action'ları wireframe'de var ama backend endpoint'leri ve email send tasarımı ayrı.
- **Mağaza bağlama wizard'ı** — "+ Mağaza bağla" CTA'sı bir wizard'a yönlendirir, bu wizard'ın adımları ayrı.
- **Settings sayfasının her bir alt sayfası** (Profil/Ekip/Faturalama/Mağazalar/Bildirimler) — yalnızca settings layout shell'i bu spec'te.
- **Yenilikler/Changelog feature** — placeholder bir nav item olarak belirtildi; içerik nereden gelir, nasıl görünür ayrı tasarım.
- **Theme picker** — toggle açık/koyu arası mevcut; system-default 3-state seçim (Auto/Light/Dark) gerekirse ayrı spec.
- **AI Assistant, Live Performance** — nav tree'de placeholder olarak listelendi (`Yeni` badge ile); bunların kendi feature spec'leri ayrı.
- **Mobile sidebar drawer'ın detaylı davranışı** — shadcn `Sidebar` primitive default davranışı kullanılır, custom davranış istenirse ayrı.

---

## 4. Shell Architecture

### 4.1 Layout

| State              | Sidebar           | Main | Notes                                                        |
| ------------------ | ----------------- | ---- | ------------------------------------------------------------ |
| Expanded (default) | 290px             | 1fr  | Brand bar + search + chip + nav scroll + bottom dock görünür |
| Collapsed          | 48px              | 1fr  | Sadece icon'lar + corner badges; hover'da tooltip + flyout   |
| Mobile (<768px)    | off-canvas drawer | full | Hamburger trigger top bar'da; drawer içinde expanded mode    |

Toggle ikonu sidebar header'ında brand'in yanında (`«` collapse / `»` expand). State `sidebar:state` cookie'sinde saklanır (shadcn `Sidebar` primitive default; SSR-safe). ⌘B klavye shortcut'u toggle eder (shadcn default).

### 4.2 Sidebar Anatomy (expanded)

```
┌─ 290px ─────────────────────────┐
│  Brand · "PazarSync" [Beta] · «  │  ← header (12px padding)
│  ┌──────────────────────────┐   │
│  │ 🔍 Ara…              ⌘K   │   │  ← search input (Command primitive trigger)
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │ [A] Acme A.Ş.            │   │  ← OrgStoreSwitcher (combined chip)
│  │     Trendyol Acme TR  ▾  │   │
│  └──────────────────────────┘   │
├─ scrollable nav body ───────────┤
│  📊 Dashboard                    │
│  📡 Canlı Performans      [Yeni] │
│  📈 Karlılık Analizi  [Beta]  ▾  │  ← group header
│    └ Sipariş Karlılığı           │  ← sub-items (when expanded)
│      Ürün Karlılığı              │
│      Kategori Karlılığı          │
│      İade Zararı                 │
│      Reklam Karlılığı            │
│  🛍 Ürünler                      │
│  📦 Siparişler              [5]  │  ← count badge (warning)
│  🛠 Maliyet & Araçlar         ▾  │
│  📋 Hakediş Kontrolü             │
│  💰 Giderler                     │
│  🔔 Uyarılar                [3]  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─          │  ← section divider (dashed)
│  🏆 Yenilikler                ▾  │
├─ bottom dock (sticky) ──────────┤
│  ❓ Destek                       │
│  ⚙️ Ayarlar                      │
│  🌗 Tema                  [○──]  │  ← inline switch
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─          │
│  [B] Berkin Oktay [Trial] ⋮     │  ← user dock row
└─────────────────────────────────┘
```

### 4.3 Sidebar Anatomy (collapsed)

```
┌─ 48px ──┐
│   [P]   │  ← brand mark + toggle on hover
│   [🔍]  │  ← search icon (click → opens Command palette overlay)
│   [A]●  │  ← OrgStoreSwitcher icon (avatar + corner badges)
├─────────┤
│  [📊]   │
│  [📡]   │
│  [📈]   │
│  [🛍]   │
│  [📦]   │
│  [🛠]   │
│  [📋]   │
│  [💰]   │
│  [🔔]   │
│  ─ ─ ─  │
│  [🏆]   │
├─────────┤
│  [❓]   │
│  [⚙️]   │
│  [🌗]   │
│  [B]    │  ← avatar (click → user menu)
└─────────┘
```

Hover bir nav-item üzerine gelince **tooltip** (label) çıkar. Bir nav-item bir **grup** ise (Karlılık Analizi gibi expandable) hover **flyout panel** açar — sub-item'lar orada gezilir; tıklayınca sidebar otomatik expand olur ve grup açılmış halde kalır.

### 4.4 Mobile

- 768px altında sidebar `off-canvas` drawer'a dönüşür (shadcn `Sidebar` primitive default davranışı; altta `Sheet` kullanır)
- Hamburger trigger ve bell + user menu için top bar `AppShell` içinde küçük bir mobile-only header olarak yer alır (mevcut `MobileTopBar` component clean delete; replacement minimal — sadece `<SidebarTrigger />` + `<NotificationBell />` + `<UserMenu />`, ayrı dosya olmadan AppShell içinde inline)
- Drawer içinde sidebar her zaman expanded mode'da render edilir (mobile için collapsed mantıksız — touch target yetersiz, hover/tooltip yok)

---

## 5. Navigation Tree

### 5.1 Primary Items + Groups

| Key                | Label (TR)        | Icon                  | Tür   | Sub-items   | Badge  |
| ------------------ | ----------------- | --------------------- | ----- | ----------- | ------ |
| `dashboard`        | Dashboard         | DashboardSquare02Icon | leaf  | —           | —      |
| `live-performance` | Canlı Performans  | (TBD)                 | leaf  | —           | `Yeni` |
| `profitability`    | Karlılık Analizi  | ChartLineData01Icon   | group | 5           | `Beta` |
| `products`         | Ürünler           | PackageIcon           | leaf  | —           | —      |
| `orders`           | Siparişler        | ShoppingBag01Icon     | leaf  | —           | count  |
| `tools`            | Maliyet & Araçlar | (TBD)                 | group | 4           | —      |
| `reconciliation`   | Hakediş Kontrolü  | InvoiceIcon           | leaf  | —           | —      |
| `expenses`         | Giderler          | ReceiptDollarIcon     | leaf  | —           | —      |
| `notifications`    | Uyarılar          | Notification03Icon    | leaf  | —           | count  |
| **— divider —**    |                   |                       |       |             |        |
| `whats-new`        | Yenilikler        | (TBD)                 | leaf  | (lazy load) | —      |

**Group sub-items:**

`profitability` → `/profitability/orders`, `/profitability/products`, `/profitability/categories`, `/profitability/returns`, `/profitability/campaigns`
`tools` → `/tools/commission-calculator`, `/tools/category-commissions`, `/tools/plus-commission-rates`, `/tools/product-pricing` (`Yeni` badge)

**Bottom dock (sticky):**

| Key        | Label                        | Tür           | Notes                                 |
| ---------- | ---------------------------- | ------------- | ------------------------------------- |
| `support`  | Destek                       | leaf link     | external chat widget veya `/support`  |
| `settings` | Ayarlar                      | leaf link     | `/settings` (kendi internal layout'u) |
| `theme`    | Tema                         | inline toggle | dark/light, system-aware              |
| `user`     | (avatar + name + Trial chip) | menu trigger  | shadcn `DropdownMenu`                 |

### 5.2 Settings Secondary Layout

Ayarlar bottom dock'ta tek leaf — tıklayınca `/settings` route'una gider. Bu route **kendi internal layout'una** sahiptir (200px secondary sidebar + content):

```
/settings/profile      — Profil
/settings/team         — Ekip
/settings/billing      — Faturalama  [Trial]
/settings/stores       — Mağazalar
/settings/notifications — Bildirimler
/settings/webhooks     — Webhooks
/settings/data-export  — Veri Dışa Aktar
/settings/danger-zone  — Hesap Sil
```

Bu secondary sidebar Linear/Stripe/Tiyasis'in kanonik settings paterninidir; ana shell'i 5+ alt-route ile şişirmemek için. Implementation: Next.js `(settings)` route group + `app/[locale]/(dashboard)/settings/layout.tsx`.

### 5.3 Migration from Current `nav-config.ts`

Mevcut `nav-config.ts`'in shape'i `NavItem | NavSection | SubNavItem` üçlüsü ile çalışıyor. Yeni nav tree için aşağıdaki extension'lar gerekir:

1. **Top-level group support** — mevcut `sections` field'ı zaten group benzeri yapıda; sadece `meta` ve `sections` ile flat (Orders sub-status filter list) arasındaki ayrımı korumak yetiyor. Yeni `tools` grubu için yeni `sections` ekle.
2. **Badge field** — `NavItemBase`'e opsiyonel `badge?: { variant: 'new' | 'beta' | 'trial', label?: string }` eklenir. Sub-item'lar için de aynı.
3. **Tone field** — `tone: 'warning'` zaten mevcut (`SubNavItem`'da count'lar için). Bu korunur.
4. **Settings nav-config'den çıkarılır** — bottom dock'tan link olarak gider, ayrı bir `settings-nav-config.ts` ile internal sidebar'da render edilir.
5. **Notifications hideFromIconRail kaldırılır** — iconRail kavramı yok artık; primary leaf olarak kalır.
6. **Section divider + `whats-new`** — `nav-config.ts`'in sonuna `divider: true` flag'li bir item + `whats-new` leaf eklenir.

---

## 6. Org + Store Switcher

### 6.1 Component: `OrgStoreSwitcher`

**File:** `apps/web/src/components/patterns/org-store-switcher.tsx` (cross-feature, app shell'in parçası).

**Data dependencies:** `useOrganizations()` (mevcut), `useStores(orgId)` (mevcut), `useOrgContext()` + `useStoreContext()` (mevcut), `useInvitations()` (yeni — placeholder, davet feature'ı ayrı).

### 6.2 States

| State               | Trigger                        | Layout                                                                                     |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Default (expanded)  | sidebar expanded               | full chip (avatar + names + chevron)                                                       |
| Hover (expanded)    | mouse over                     | hover bg + ⌘O kbd hint görünür                                                             |
| Default (collapsed) | sidebar collapsed              | icon-only avatar (`size-lg` = 32px, `pointer-coarse:size-11` = 44px touch) + corner badges |
| Hover (collapsed)   | mouse over icon                | tooltip + flyout panel anchor                                                              |
| Open dropdown       | click chip / icon / ⌘O         | layered popover, 380px wide, max 480px tall                                                |
| Search active       | type in dropdown input         | fuzzy filter, highlight match, footer dynamic                                              |
| Empty (no org)      | user has 0 orgs                | "+ Yeni Org" + "📨 Davet Kodum Var" CTAs                                                   |
| Pending invite      | user has 1+ pending invites    | invite section'ı en üstte, kabul/red inline                                                |
| Multi-org (5+)      | user has 5+ orgs               | "Son Kullanılan (3)" + "Tüm (N)" iki bölüm                                                 |
| Sync warning        | active store sync stale/failed | corner badge → warning/error rengi, store name'de pulse rengi değişir                      |

### 6.3 Visual Anatomy

**Org avatar (`size-lg` = 32px expanded, `size-lg` = 32px collapsed; `pointer-coarse:size-11` = 44px touch target):**

- Background: solid color from a 6-element palette of semantic tokens — `[--primary, --success, --warning, --info, --destructive, --accent]`
- Seed function: `hash(org.id) % 6` → palette index'i seçer (deterministic, kullanıcı oturumu boyunca aynı org aynı renk)
- Foreground: solid color'ın eşlenen `*-foreground` token'ı (örn. `--primary` → `--primary-foreground`); shadcn semantic contract; 4.5:1 contrast garantili
- İlk harf bold (Host Grotesk semibold), tabular-nums gerektirmiyor (tek harf)
- **Gradient kullanılmıyor** — solid semantic tokens. Token disiplini için arbitrary hex / raw oklch() ihlal edilmez.

**Platform corner badge (sağ alt, `size-3xs` = 16px container, içinde `MarketplaceLogo size="sm"` = 20px):**

- Mevcut `<MarketplaceLogo platform={store.platform} size="sm" alt="" />` pattern reuse edilir
- Brand SVG'leri (`/brands/trendyol.svg`, `/brands/hepsiburada.svg`) — gerçek vendor renkleri
- Avatar tasarımıyla overlap pozisyon CSS ile (`absolute -bottom-1 -right-1`)
- **Yeni token EKLENMEZ** — `marketplace-logo.tsx`'in mevcut yorumu (vendor brand renkleri token sisteminde olmamalı) korunur
- Logo'nun arkasında 2px `bg-card` ring contrast için (CSS `box-shadow: 0 0 0 2px var(--card)` veya `outline`)

**Sync pulse (sol üst, `size-2xs` = 8px):**

- `bg-success` (fresh, son senkron <30dk) — solid semantic token
- `bg-warning` (stale, 30dk–3sa)
- `bg-destructive` (failed veya >3sa) — `--error` yerine shadcn'in canonical `--destructive` token'ı kullanılır
- Border: `box-shadow: 0 0 0 2px var(--card)` (avatar üzerinde okunabilirlik için)

**Multi-org indicator (sol alt, opsiyonel, `size-3xs` = 12px square):**

- Sadece 2+ org varsa render edilir, collapsed mode'da
- "+N" etiketi, `bg-card` border'lı + `text-muted-foreground`, tabular-nums (sayı küçük olduğu için isteğe bağlı ama tutarlılık için)
- Click → flyout panel açar (popover anchored to icon)

**Names block (expanded mode):**

- `org-name`: `text-sm font-medium text-foreground`, line-clamp-1
- `store-name`: `text-2xs text-muted-foreground`, line-clamp-1, sync-pulse-dot ile birlikte
- **Tüm visible text next-intl `t()` üzerinden** — store name backend'den gelir (i18n yok), ama "ORG" gibi mini etiketler `chip.org`, `chip.storePicker` key'leri altında localize

**Role badges (dropdown'da, shadcn `Badge` primitive `variant=` ile):**

- Owner: `bg-primary text-primary-foreground` (CTA tier emphasis)
- Admin / Member: `bg-muted text-muted-foreground border` (ghost tier, yan yana okunaklı)
- Davet bekleyen: `bg-warning-surface text-warning` (semantic tone contract — chip tier `*-surface` + `text-*` çifti, **`bg-warning + text-warning-foreground` değil** çünkü surface contract'ı)

**Active state — BAN 1 uyumlu:**

- Active row vurgusu **sadece** `bg-accent` (subtle bg tint) + sağda check icon (`Check` from `hugeicons-react`)
- **Side-stripe border kullanılmıyor** (`border-left` ban'lı, e04683b commit'inde aynı problem zaten çözüldü)
- Hover row: `bg-muted` (default'tan ayırt için subtle), no border change

**Focus-visible (mandatory, tüm interactive elements):**

- Chip, dropdown rows, footer buttons, theme toggle, settings icon button: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
- shadcn primitive'leri (Button, Popover, Command) zaten bu pattern'ı uyguluyor; custom span'lerde manuel ekleme

### 6.4 Behavior

- **Click chip / collapsed icon** → dropdown açılır, search input'a otomatik focus
- **⌘O klavye shortcut** → dropdown açar (sidebar collapse durumundan bağımsız)
- **⌘K from chip** → genel arama palette'ini açar (sidebar header'daki search input'tan farklı, app-wide)
- **Type in search** → fuzzy match orgs + stores; cross-match logic (org içinde geçen store ismi org'u da match'ler)
- **↑↓ + Enter** → klavye nav, seçim
- **Escape** → dropdown kapanır
- **Click org row** → org'a switch eder (org-context provider günceller); dropdown stores section'a auto-scroll eder, default store seçilir
- **Click store row** → store'a switch eder; dropdown kapanır; React Query cache'leri yeni store key'iyle invalidate olur
- **Click "⚙ Org ayarları"** → switch yapar + `/settings/profile`'a navigate eder
- **Click "+ Yeni Org"** → `/onboarding/create-organization`'a navigate eder
- **Click "+ Mağaza bağla"** → `/onboarding/connect-store?orgId={current}`'a navigate eder

---

## 7. Page-Level Context Patterns

Mevcut Context Rail'in sayfa-spesifik içerikleri page-level UI'ye iner. Aşağıdaki tablo eski yer → yeni yer eşlemesini verir:

| İçerik                                      | Eski (Context Rail)                         | Yeni                                                              |
| ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| Dashboard "Hızlı Erişim" warning kartları   | ContextRail middle (DashboardContextMiddle) | Dashboard page body, KPI grid'in üstünde 3-card warning row       |
| Date range chips (Profitability)            | (planlanmıştı)                              | PageHeader actions ya da page-toolbar (sayfa-spesifik)            |
| Saved views (Orders, Products)              | (planlanmıştı)                              | PageHeader actions dropdown ("📌 Görünüm ▾")                      |
| Recent SKUs (Products)                      | (planlanmıştı)                              | Page-toolbar dropdown ("📁 Son SKU ▾")                            |
| Bulk action banner (Products)               | (planlanmıştı)                              | Page body sticky banner (selection olunca)                        |
| Sub-nav (Orders status filters)             | ContextRail SubNavList                      | Page-toolbar tab strip (filter chips), URL `?status=`             |
| Sub-nav (Profitability reports)             | ContextRail SubNavList                      | Sidebar inline expand (group child) — bu spec'in core değişikliği |
| Pinned comparisons (Profitability)          | (planlanmıştı)                              | Page-toolbar dropdown ("📊 Karşılaştır ▾")                        |
| Sync sparkline (Dashboard)                  | ContextRail "Senkron Sağlığı"               | Dashboard KPI grid'in 5. kartı (`SyncHealthSparkline` pattern)    |
| Settlement period selector (Reconciliation) | (planlanmıştı)                              | PageHeader actions ("📅 Nisan 2026 ▾")                            |

**Kural:** Sidebar shell-agnostic kalır (org/nav/dock/user); sayfa-spesifik state ve filter UI page'in kendisinde yaşar. Bu rule ileride yeni feature ekleneceği zaman tasarım kararını basitleştirir.

---

## 8. Badge System

Inline badges nav-item'larda ve dropdown row'larında. Üç semantic variant, hepsi mevcut tokenlara map'lenir:

| Variant           | Token (bg)   | Token (text)              | Use case                                         |
| ----------------- | ------------ | ------------------------- | ------------------------------------------------ |
| `new`             | `bg-success` | `text-success-foreground` | Yeni shipping feature (ilk 30 gün)               |
| `beta`            | `bg-warning` | `text-warning-foreground` | Beta feature (henüz GA değil)                    |
| `trial`           | `bg-warning` | `text-warning-foreground` | Trial plan göstergesi (avatar yanı)              |
| `count` (warning) | `bg-warning` | `text-warning-foreground` | Aksiyon gerektiren sayı (Bekleyen 5, Uyarılar 3) |
| `count` (neutral) | `bg-muted`   | `text-muted-foreground`   | Bilgilendirici sayı (Tümü 1284)                  |

Yeni token tanımlanmaz; mevcut OKLCH palette yeterli. Badge component shadcn `Badge` primitive'ine bir variant eklenmesi yeter (`new` / `beta` / `trial` discriminated union — `cva` ile). `nav-config.ts`'de item'lara opsiyonel `badge` field'ı eklendiğinde sidebar bunu otomatik render eder.

---

## 9. Token Discipline

Tüm bu tasarım mevcut design system token'ları üzerinde çalışır. **Yeni renk token'ı eklenmez.** Sadece bir yeni spacing token'ı eklenir (dropdown popover sizing için).

| Aspect            | Token                                                  | Notes                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renk              | OKLCH palette (hue 265 tinted)                         | **Yeni hue veya color token EKLENMEZ.** Marketplace platform renkleri vendor'a ait → mevcut `MarketplaceLogo` component (`/brands/*.svg`) üzerinden taşınır. `marketplace-logo.tsx`'in koruyucu yorumu ("dashboard tokens intentionally don't carry these since they belong to vendors") bu spec ile aynı çizgide |
| Tipografi         | Host Grotesk                                           | Mevcut. KPI değerleri ve sayısal sütunlar (`tabular-nums`): `font-variant-numeric: tabular-nums` zorunlu — Tailwind utility `tabular-nums`                                                                                                                                                                        |
| Spacing           | `--space-*` 4pt scale                                  | Mevcut. **Tüm boyutlar 4pt grid'e snap edilir**: avatar 32 (`size-lg`), chip yüksekliği 40 (paddingten oluşur, 32+`py-xs` \*2 ≈ 40), corner badge 16 (`size-3xs`), pulse 8 (`size-2xs`), multi-org indicator 12 (`size-3xs`)                                                                                      |
| Sizing role       | `--size-dropdown-popover: 24rem` (yeni token)          | 384px popover için role-based size token. `apps/web/src/app/tokens/spacing.css`'e eklenir, `@theme inline` ile expose edilir, `max-w-dropdown-popover` utility'si üretilir. Arbitrary `w-[380px]` kullanılmaz                                                                                                     |
| Shadow            | `--shadow-md` (dropdown popover)                       | Mevcut, dual-mode (dark için inset highlight, kendiliğinden)                                                                                                                                                                                                                                                      |
| Radius            | `--radius-md` (chip), `--radius-lg` (dropdown popover) | Mevcut                                                                                                                                                                                                                                                                                                            |
| Transition        | `duration-fast` + `ease-out-quart`                     | Mevcut tokens. Sidebar collapse/expand: `duration-base` (250ms) `ease-out-quart`                                                                                                                                                                                                                                  |
| Avatar background | 6 mevcut semantic token                                | `[--primary, --success, --warning, --info, --destructive, --accent]` — hash(orgId) ile pick. Yeni token yok                                                                                                                                                                                                       |
| i18n              | `next-intl` `t()` ile her görünür label                | `nav-config.ts`'in mevcut `labelKey: 'nav.foo'` paterni korunur; yeni grup label'ları (Karlılık Analizi, Maliyet & Araçlar, Yenilikler) `messages/tr.json` + `en.json` altında ilgili namespace'e eklenir. Inline TR yasak                                                                                        |

**Ban list compliance:**

- ✅ **BAN 1 (side-stripe)** — Aktif dropdown row vurgusu sadece bg-tint + check icon, side-stripe yok (e04683b commit'inde aynı problem zaten çözüldü; bu spec o disiplini sürdürür).
- ✅ **BAN 2 (gradient text)** — Avatar harfleri ve tüm label'lar solid color; gradient text hiçbir yerde yok.
- ✅ **BAN 3 (glassmorphism)** — Dropdown popover full-opaque `bg-popover`; backdrop-blur kullanılmaz. Sidebar background da solid.
- ✅ **BAN 4 (celebratory animation)** — Org switch / store switch transition'ı `duration-fast` + ease-out, bounce/elastic yok.
- ✅ **Tailwind T3-era `max-w-md` collision** — Dropdown popover `max-w-dropdown-popover` (yeni role-based token) kullanır; T3 isimleri yok.
- ✅ **Arbitrary values** (`bg-[#…]`, `p-[13px]`, `w-[380px]`) — Hiçbir yerde yok; ESLint zaten yakalardı.
- ✅ **Touch target** — Collapsed avatar 32px (`size-lg`); `pointer-coarse:size-11` (44px) variant ile mobile/touch'ta expand. Tooltip'ler touch'ta gösterilmez (`hover:` yerine `pointer-coarse:`'a saygı).
- ✅ **focus-visible** — Tüm interactive elements (chip, dropdown rows, footer buttons, theme toggle, settings icon, multi-org indicator) `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- ✅ **Semantic tone contract** — Chip-tier kullanımlar `bg-<tone>-surface + text-<tone>` (örn. davet badge'i); solid-tier kullanımlar `bg-<tone> + text-<tone>-foreground` (örn. trial chip, owner badge); icon-only kullanımlar `text-<tone>` (örn. sync pulse'lar tek dot olduğu için solid `bg-<tone>` yeterli).

---

## 10. Implementation Components

### 10.1 UI Cascade

| Layer                                      | Item                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **patterns/** (mevcut, reuse)              | `marketplace-logo.tsx`                                                                                                      | platform mark için                                                                                                                                                                                                                                                                                                                     |
|                                            | `sync-badge.tsx`                                                                                                            | sync status pulse'lar için                                                                                                                                                                                                                                                                                                             |
| **patterns/** (yeni)                       | `bottom-dock.tsx`                                                                                                           | sidebar dibi sticky cluster (Destek/Ayarlar/Tema/User)                                                                                                                                                                                                                                                                                 |
|                                            | `org-store-switcher.tsx`                                                                                                    | sidebar header'ındaki kombine chip + dropdown                                                                                                                                                                                                                                                                                          |
|                                            | `nav-group.tsx`                                                                                                             | expandable group (header + sub-items, animasyonlu)                                                                                                                                                                                                                                                                                     |
|                                            | `theme-toggle-inline.tsx`                                                                                                   | bottom dock'taki switch (mevcut UserMenu dropdown'unda farklı versiyonu var). **SSR-safe**: hem Sun hem Moon ikonu render edilir, `dark:` Tailwind variant'ı ile CSS-only swap (apps/web/CLAUDE.md "SSR safety" #1 paterni — `useTheme()` render-time'da okunmaz, `next-themes` head script'i `class="dark"`'i hydration öncesi koyar) |
| **ui/** (mevcut, reuse)                    | `popover.tsx`, `command.tsx`, `avatar.tsx`, `tooltip.tsx`, `scroll-area.tsx`, `badge.tsx`, `dropdown-menu.tsx`, `sheet.tsx` | hepsi var                                                                                                                                                                                                                                                                                                                              |
| **ui/** (yeni, registry)                   | `sidebar.tsx`                                                                                                               | `pnpm dlx shadcn@latest add sidebar`                                                                                                                                                                                                                                                                                                   |
| **components/layout/** (yeni veya yeniden) | `app-shell.tsx`                                                                                                             | mevcut 3-rail shell baştan yazılır; shadcn Sidebar primitive'i kullanır                                                                                                                                                                                                                                                                |
| **components/layout/** (delete)            | `icon-rail.tsx`, `context-rail.tsx`, `mobile-top-bar.tsx`, `mobile-nav-sheet.tsx`, `store-switcher.tsx`                     | mevcut shell artifact'leri; shadcn Sidebar (Sheet üzerine kurulu mobile drawer dahil) + OrgStoreSwitcher ile yer değiştirir, conversion değil clean delete                                                                                                                                                                             |
| **components/layout/** (extend)            | `nav-config.ts`                                                                                                             | `badge` + `divider` field'ları eklenir; shape genişler ama backward compat (mevcut `tone`, `sections`, `meta` korunur)                                                                                                                                                                                                                 |

### 10.2 New Files

```
apps/web/src/
├── components/
│   ├── patterns/
│   │   ├── bottom-dock.tsx                 (yeni)
│   │   ├── org-store-switcher.tsx          (yeni)
│   │   ├── nav-group.tsx                   (yeni)
│   │   └── theme-toggle-inline.tsx         (yeni)
│   ├── ui/
│   │   └── sidebar.tsx                     (shadcn registry)
│   └── layout/
│       ├── app-shell.tsx                   (rewrite, sadece shadcn Sidebar wrapper)
│       └── nav-config.ts                   (extend)
├── lib/
│   └── org-avatar-color.ts                 (yeni — deterministic gradient seed)
└── app/[locale]/(dashboard)/settings/
    └── layout.tsx                          (yeni — settings secondary layout)
```

### 10.3 Deleted Files

```
apps/web/src/components/layout/
├── icon-rail.tsx                           (delete)
├── context-rail.tsx                        (delete)
├── mobile-top-bar.tsx                      (delete — AppShell içinde inline mobile header, ayrı dosya gerekmez)
├── mobile-nav-sheet.tsx                    (delete — shadcn Sidebar mobile mode otomatik Sheet kullanır)
└── store-switcher.tsx                      (delete — OrgStoreSwitcher ile yer değişti)

apps/web/src/features/dashboard/components/
└── dashboard-context-middle.tsx            (delete — content Dashboard page'e taşınır)
```

### 10.4 Token Additions

**Tek yeni token**: dropdown popover için role-based sizing. Renk token'ı eklenmiyor (vendor brand renkleri `MarketplaceLogo` SVG'lerine devredilir; org avatar arkaplan'ı 6 mevcut semantic token'dan seçilir; sync pulse'lar mevcut `--success` / `--warning` / `--destructive`).

`apps/web/src/app/tokens/spacing.css` (mevcut role-based size'ların yanına):

```css
:root {
  /* role-based sizing for popovers — avoids T3-era max-w-md collision */
  --size-dropdown-popover: 24rem; /* 384px — org+store switcher panel */
}
```

`apps/web/src/app/globals.css` `@theme inline` block'unda zaten var olan role-based size export pattern'i takip eder:

```css
@theme inline {
  --size-dropdown-popover: var(--size-dropdown-popover);
}
```

→ `max-w-dropdown-popover` utility'si üretilir. Component code'unda `<PopoverContent className="max-w-dropdown-popover">` olarak tüketilir.

### 10.5 Migration Database

`organization_members` tablosuna yeni kolon:

```sql
ALTER TABLE organization_members
ADD COLUMN last_accessed_at TIMESTAMPTZ;

CREATE INDEX idx_org_members_user_last_accessed
ON organization_members (user_id, last_accessed_at DESC NULLS LAST);
```

Trigger: org switch yapıldığında bu field güncellenir (backend `/v1/organizations/:id/switch` endpoint'i veya context provider).

RLS policy: kullanıcı sadece kendi `user_id`'sinin kayıtlarını okur/yazar — mevcut `organization_members` policy'si ile birebir uyumlu, ek policy gerekmez.

### 10.6 React / SSR Pattern Compliance

`apps/web/CLAUDE.md`'in "SSR safety" + "React Best Practices" bölümlerinin gereği — bu spec'in component'lerinde uygulanacak:

- **Server Component default, `'use client'` sadece interaktiflik için** — `app-shell.tsx`, `bottom-dock.tsx`, `org-store-switcher.tsx`, `nav-group.tsx`, `theme-toggle-inline.tsx` hepsi `'use client'` (state, popover, click handlers var). `(settings)/layout.tsx` ise server component (route group layout, navigation prop'ları statik).
- **Theme reading SSR trap'i** — `useTheme()` / `resolvedTheme` render path'inde okunmaz. `theme-toggle-inline.tsx` Sun + Moon ikonlarını HER zaman render eder, `dark:` variant CSS swap'ı yapar. `next-themes`'in head script'i `class="dark"`'i hydration öncesi koyar — first-paint'ten itibaren doğru icon görünür.
- **`new Date()` / `Date.now()` render path'inde yok** — sync timestamp'leri (`store-name`'in altında "3 dk önce" gibi) `useFormatter()` + `useIsMounted()` ile mount sonrası hesaplanır; mount öncesi stable fallback (`formatter.dateTime(lastSyncedAt, 'short')`).
- **Nested `<button>` yasağı** — `Popover`/`DropdownMenu` trigger'ı zaten `<button>` render eder. Org switcher chip'i bir `Popover.Trigger` içinde, child olarak `<span role="button" tabIndex={0}>` kullanılmaz çünkü chip'in kendisi trigger. Multi-org indicator (collapsed mode) bir overlay icon — chip içine `<button>` koymak nested-button olur, bunun yerine indicator pure-CSS dekorasyon (click chip'in üstünde değil, chip'i tıklayınca dropdown açar).
- **`useEffect` minimum** — derived state (örn. "kaç org var?", "hangisi aktif?") render time'da `useMemo` ile compute edilir; `useEffect` sadece eventBus subscribe (örn. `AUTH_SESSION_EXPIRED`) için.
- **Prop drilling 3+ level olduğunda context** — Sidebar → BottomDock → ThemeToggleInline kısa zincir, prop drilling yok. OrgStoreSwitcher kendi state'ini taşır (popover open, search query); dropdown content'i child component'lere `OrgStoreSwitcherContext` üzerinden geçirebilir (4+ level varsa).
- **Format presetleri `formats.ts`'te** — "3 dk önce", "Son 7 gün", "Bugün" gibi label'lar `useFormatter().relativeTime` veya stable preset; inline `Intl.DateTimeFormat` yok.
- **State management hierarchy**: store ID seçimi `nuqs` URL state olarak mevcut (`useStoreContext` zaten bunu wrap'liyor). Org ID context'te (`useOrgContext`). Switcher dropdown open/closed `useState` (local UI). Server data (`useOrganizations`, `useStores`) React Query.

---

## 11. Migration Strategy

Mevcut shell shipping olduğu için big-bang yerine **3-fazlı geçiş** önerilir:

### Faz 1 — Foundation (PR 1)

- shadcn Sidebar primitive ekle (`add sidebar`)
- Yeni `BottomDock`, `NavGroup`, `OrgStoreSwitcher`, `ThemeToggleInline` patterns yaz (component'leri izole, henüz shell'e bağlı değil)
- `/design/patterns` showcase'e ekle
- `org-avatar-color.ts` util + birim test
- `nav-config.ts` shape extend (badge, divider) + mevcut tüm renderlarda backward compat
- `last_accessed_at` migration + trigger
- `--size-dropdown-popover` role-based size token ekle (`spacing.css` + `@theme inline`)

### Faz 2 — Shell Switch (PR 2)

- Yeni `AppShell` shadcn Sidebar üzerine yazılır
- Eski `IconRail`, `ContextRail`, `MobileTopBar`, `MobileNavSheet`, `StoreSwitcher`, `DashboardContextMiddle` silinir
- Tüm `/design/layout-demo` showcase yeni shell ile re-build
- E2E test: shell collapse/expand, mobile drawer, tooltip, flyout
- Dashboard page'in "Hızlı Erişim" warning'leri page body'ye taşınır

### Faz 3 — Settings + Sub-route Polish (PR 3)

- Settings secondary layout (`(settings)/layout.tsx`)
- Settings sub-pages link'leri ana nav'dan çıkar, internal'a taşınır
- Sub-nav grupları (Profitability, Tools) `nav-config.ts`'e eklenir
- Yenilikler placeholder leaf eklenir (içerik ayrı feature)

Her PR ayrı çalışır, kademeli ship olur. PR 1 hiçbir görsel değişiklik yapmaz; PR 2 büyük cut-over. Faz tasarımı `writing-plans` skill'inde detaylanır.

---

## 12. Open Questions for Implementation Plan

1. **Avatar gradient palette** — 6 distinct kombinasyon yeterli mi, yoksa 8-10 olmalı mı? `hash(orgId) % palette.length` collision görünür mu? (Plan'da: 6 ile başla, kullanıcı geri bildirimine göre artır.)
2. **`whats-new` content source** — Linear/Vercel'in changelog'u nasıl beslenir? Markdown dosyalar mı, CMS mi, manuel? (Bu spec dışı; `whats-new` placeholder olarak ship edilir.)
3. **Multi-org indicator (collapsed mode "+N")** — sadece görsel mi, yoksa flyout panel açar mı? (Plan'da: panel açar, expanded mode'la simetrik.)
4. **Settings sub-pages tek tek yazılacak mı yoksa scaffold ile mi?** — `/settings/profile` ve `/settings/stores` zaten mevcut; `/settings/team`, `/settings/billing`, `/settings/notifications`, `/settings/webhooks`, `/settings/data-export`, `/settings/danger-zone` placeholder olabilir. Spec'in scope'u dışı; plan ayırır.
5. **Theme toggle 3-state mi 2-state mi?** — Şu an dark/light. System-default option istenirse `theme-toggle-inline.tsx` 3-state radio veya cycling button olur. (Plan'da: 2-state ile başla, geri bildirimle 3-state'e geçilir.)
6. **Yeni nav item ikon seçimi** — `live-performance`, `tools`, `whats-new` için hugeicons-react'ten ikon seçimi (örnek adaylar: `Activity01Icon`/`PulseIcon`/`RadioIcon` for live; `Wrench02Icon`/`Calculator01Icon` for tools; `Megaphone01Icon`/`Stars01Icon` for whats-new). Tasarım tutarlılığı için diğer 7 nav item ile aynı stroke-weight'te seçim. Plan içinde finalize edilir.

---

## 13. References

- **Brainstorm artifacts:** `.superpowers/brainstorm/91783-1777121849/content/`
  - `kickoff.html` — initial baseline
  - `candidate-shells.html` — 5-shell catalog
  - `deep-dive-all-shells.html` — 5-shell deep dive (3, 4, 5 elendi)
  - `3rail-vs-sidebar-page-stress-test.html` — Context Rail justification across 4 pages
  - `corrected-nested-nav.html` — sub-nav model correction (filter → nested groups)
  - `tek-sidebar-page-states.html` — final shell, 5 page states + collapsed mode
  - `org-store-switcher.html` — switcher detailed design
- **Visual reference:** dev server `/design/tokens` · `/design/primitives` · `/design/patterns` · `/design/layout-demo`
- **shadcn Sidebar docs:** https://ui.shadcn.com/docs/components/sidebar
- **Existing files to read before plan:**
  - `apps/web/src/components/layout/nav-config.ts`
  - `apps/web/src/components/layout/app-shell.tsx`
  - `apps/web/src/components/patterns/sub-nav-list.tsx`
  - `apps/web/src/components/patterns/marketplace-logo.tsx`
  - `apps/web/src/components/patterns/sync-badge.tsx`
  - `apps/web/src/features/auth/components/user-menu.tsx`
  - `apps/web/CLAUDE.md` § "UI Development Workflow"
  - Root `CLAUDE.md` § "Coding Standards"
- **Competitor visual references:** Tiyasis (BETA), one Turkish marketplace profit analytics tool — screenshots şared by Berkin in brainstorm session.
