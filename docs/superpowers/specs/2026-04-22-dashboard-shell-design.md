# Dashboard Shell Yeniden Tasarımı

**Tarih:** 2026-04-22
**Durum:** Onaylandı (brainstorm)
**Kapsam:** Shell (icon rail + context rail) + Dashboard ana içerik + responsive davranış

---

## 1. Özet

PazarSync'in mevcut "dual-rail" shell'i (`IconRail` + `ContextRail` + `Main` + `ActivityRail`) iki sorun barındırıyor:

1. **Context rail ortası yarı-boş.** Sadece `Orders`, `Products`, `Profitability` route'larında sub-nav göstermek üzere konfigüre edilmiş. `Dashboard`, `Reconciliation`, `Expenses`, `Settings` için boş — kullanıcı "buraya ne gelecek?" sorusunu soruyor.
2. **Activity rail az değer / çok chrome.** 32px persistent kolon yalnız bell ikonu gösteriyor; rakipler (Melontik, Tiyasis) bu konsepti hiç kullanmıyor.

Aynı zamanda Dashboard ana içeriği rakiplerle karşılaştırıldığında **sparse**: 4 KPI tile + bir org card + connect-store CTA. Vision doc'a göre platform "detaylı kâr raporları" üretecek — ana içerik **çok daha yoğun** (Melontik tier) olmak zorunda.

Bu spec hem shell'i sadeleştiriyor hem de Dashboard'ın ana içeriğini rakip-tier yoğunluğa taşıyor.

## 2. Hedefler ve Sınırlar

### Hedefler

- Shell'i **3 kolona** indir (Icon + Context + Main); Activity rail kaldırılsın.
- Context rail middle'a **per-page sub-navigation** ver — sayfaya göre adapte (Tiyasis count-tab paterni).
- Dashboard context rail'inde scroll-spy yerine **store summary + period presets**.
- Dashboard ana içeriğini **Melontik yoğunluğunda** doldur: 5 KPI sparkline + cost donut + line chart + funnel + ürün/sipariş metrik panelleri + en karlı/zararlı ürünler.
- Context rail bottom'daki tüm utility actions'ı taşı: sync **kaldır**, add-store **store switcher dropdown**'a, theme + language **user menu dropdown**'a.
- Mobile (<768px) ve tablet (768–1024px) için shell **slide-over Sheet** paterni ile davransın.
- Mevcut `patterns/` ve `ui/` koleksiyonunu kullan; primitive forklamadan, token sistemini bozmadan.

### Sınırlar (bu spec'in kapsamında **değil**)

- Auth sayfaları (`/login`, `/register`, `/onboarding`)
- Backend endpoint değişiklikleri (mevcut API contract'leri yeterli; sadece Dashboard için ek metrik endpoint'leri sonraki spec'te)
- Reconciliation, Expenses, Settings sayfalarının **iç tasarımı** (yalnız sub-nav stratejisi tanımlı; içerik ayrı spec)
- Hepsiburada entegrasyonu (Trendyol-only; Phase 1 backlog'u)
- "/notifications" sayfası iç tasarımı (yalnız bell → popover akışı tanımlı)

## 3. Final Shell Mimarisi

```
┌──────┬──────────────────┬───────────────────────────────────────────┐
│ Icon │ Context Rail     │ Main Content                              │
│ Rail │ (220px desktop)  │ (1fr)                                     │
│ 48px │                  │                                           │
│      │ Top:             │ PageHeader (title, intent, meta, actions  │
│  L   │  - Org switcher  │  with bell + period + page-specific btn)  │
│  N1  │  - Store switch- │ ───────────────────────────────────────── │
│  N2  │    er PROMINENT  │                                           │
│  N3  │                  │ Dense metric body (Melontik tier)         │
│  N4  │ Middle:          │  - KPI grid (5 tiles, sparkline bg)       │
│  N5  │  - Page-adapted  │  - Cost breakdown (donut + 8 categories)  │
│  N6  │    sub-nav       │  - Profit trend (line)                    │
│  N7  │  - Conditional   │  - Net profit funnel                      │
│      │    warning card  │  - Product / Order metric panels          │
│      │                  │  - Top profitable / loss-making products  │
│  Av  │ (no bottom)      │                                           │
└──────┴──────────────────┴───────────────────────────────────────────┘
   ↑ User avatar opens UserMenu (theme, language, profile, logout, ...)
```

Activity rail tamamen kaldırıldı. Bell PageHeader'a taşındı.

### 3.1 AppShell

`apps/web/src/components/layout/app-shell.tsx`

Mevcut grid `grid-cols-[auto_auto_1fr_auto]` → `grid-cols-[auto_auto_1fr]` olur. `ActivityRail` import'u silinir, props imzasından `activity` kaldırılır.

```tsx
<div className="bg-background text-foreground grid h-full grid-cols-[auto_auto_1fr] grid-rows-1 overflow-hidden">
  <IconRail />
  <div className="hidden md:block">
    <ContextRail ... />
  </div>
  <main id="main" className="...">
    <div className="max-w-content-max ...">{children}</div>
  </main>
</div>
```

Mobile (<md): hamburger trigger açılan **Sheet** içinde context rail içeriği; ayrı yeni component.

### 3.2 Context Rail

`apps/web/src/components/layout/context-rail.tsx`

**Top (mevcut, hafif rafine):**

- Org switcher: küçük utility row (mevcut, ~32px yükseklik). Sessiz.
- Store switcher: **prominent** kart (mevcut `StoreSwitcher` zaten Popover + Command kullanıyor; styling'i biraz büyültülecek — ~48px yükseklik, status dot + platform label görünür).
  - Dropdown'ın sonunda `+ Yeni mağaza bağla` (mevcut `onAddStore` handler'ı kullanılıyor).

**Middle (yeni — per-page adaptasyon):**

Sayfaya göre üç tip içerik:

| Sayfa          | Middle içerik                                                                    | Component                                                     |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Dashboard      | Store summary card + Period presets                                              | Yeni `StoreSummaryCard`, yeni `PeriodPresetList`              |
| Orders         | Status sub-nav (All / Pending / ...) — count rozetli                             | Yeni `SubNavList` (mevcut `nav-config` items'ı geliştirilmiş) |
| Products       | Catalog + data quality tabs (Aktif / Taslak / Maliyetsiz / Desisiz / Düşük stok) | `SubNavList`                                                  |
| Profitability  | View switcher + sub-reports (Sipariş / Ürün / Kategori / İade / Reklam)          | `SubNavList`                                                  |
| Reconciliation | Status tabs (Eşleşen / Bekleyen / Uyumsuz)                                       | `SubNavList`                                                  |
| Expenses       | Kategori tabs (Tümü / Ürün / Reklam / Paketleme / Diğer)                         | `SubNavList`                                                  |
| Settings       | Sub-sections (Profil / Ekip / Fatura / Mağaza bağlantıları / Bildirimler)        | `SubNavList`                                                  |

`SubNavList` ortak pattern: section başlığı + items. Her item: label + opsiyonel **count badge** (Tiyasis-style). Aktif item indigo border-left + bg.

```tsx
<SubNavList
  heading={t('navSections.products.catalog.title')}
  items={[
    { key: 'active', labelKey: 'navSections.products.catalog.active', href: '/products', count: 115 },
    { key: 'missing-cost', labelKey: 'navSections.products.catalog.missingCost', href: '/products?filter=no-cost', count: 12, tone: 'warning' },
    ...
  ]}
/>
```

**Conditional Warning Card:** Dashboard ve Products sayfalarında, eksik veri / sync hatası varsa rail middle'ın altında uyarı kartı (sarı). `EmptyState` benzeri ama daha kompakt — yeni `RailWarningCard` pattern.

**Bottom:** Tamamen kaldırılır (sync button → page-specific actions; add-store → store switcher dropdown; lang+theme → user menu).

### 3.3 IconRail + UserMenu Genişletme

**IconRail** (mevcut, dokunulmuyor): logo + nav items + user avatar (bottom).

**UserMenu** (`apps/web/src/features/auth/components/user-menu.tsx`) genişletilecek:

```
┌────────────────────────────────┐
│ [B] Berkin Oktay               │
│     berkin@example.com         │
├────────────────────────────────┤
│ 👤 Profil                      │
│ ⚙ Ayarlar                      │
├────────────────────────────────┤
│ Tema                           │
│ [☀ Açık | 🌙 Koyu | ⌥ Sistem]  │
│                                │
│ Dil                            │
│ [🇹🇷 TR | 🇬🇧 EN]                │
├────────────────────────────────┤
│ 📖 Yardım & Dokümanlar         │
│ ⌨ Kısayollar          ⌘?       │
│ 💬 Geri bildirim               │
├────────────────────────────────┤
│ ↪ Çıkış yap                    │
└────────────────────────────────┘
```

Mevcut `DropdownMenu` (shadcn) yapısı korunur; eklenecek slotlar:

- Header: Avatar + name + email (DropdownMenuLabel custom render)
- Profil / Ayarlar: `DropdownMenuItem` (router.push)
- Tema toggle: `DropdownMenuLabel` + `ToggleGroup` (shadcn `toggle-group` mevcut, 3-way segmented)
  - `next-themes` ile entegre (mevcut wiring varsa kullan; yoksa provider'ı ekle — root `[locale]/layout.tsx` veya `providers/`'da)
- Dil toggle: `ToggleGroup` 2-way; mevcut `LanguageSwitcher` mantığını içe gömer (locale switch via next-intl router)
- Help / Shortcuts / Feedback: `DropdownMenuItem` (sırasıyla docs sayfası, kbd shortcut overlay, feedback modal — ileride; placeholder href yeterli)
- Çıkış: mevcut `useSignOut` (kırmızı tonda, `text-destructive`)

**Önemli:** Theme toggle eklemeden önce `next-themes` ThemeProvider'ın root layout'a mount edildiğini doğrula; mount edilmemişse mount et (CLAUDE.md → "Dark-mode discipline" ve "SSR safety" bölümlerine uy).

### 3.4 PageHeader — Bell + Period + Refresh

`apps/web/src/components/patterns/page-header.tsx`

Mevcut `PageHeader` yapısı korunur (title + intent + meta + actions). `actions` slot'una **NotificationBell** + **PeriodPicker** + opsiyonel **RefreshButton** yerleştirilir.

`NotificationBell` yeni component (`patterns/notification-bell.tsx`):

- Trigger: 30×30 button + bell ikon + opsiyonel count badge (kırmızı/turuncu)
- Açılınca `Popover` (shadcn) — son 5 olay listesi (success / warning / info ikonlarıyla)
- Footer: "Tümünü gör" → `/notifications` route
- Mobile: aynı popover paterni; klavye erişimi için `aria-controls`

`PeriodPicker`: mevcut `DateRangePicker` zaten var (`patterns/date-range-picker.tsx`). Action slot'a o yerleştirilir; preset değişimi context rail'deki `PeriodPresetList` ile two-way bound (URL params üzerinden — `nuqs`).

`RefreshButton`: opsiyonel, sayfa-spesifik. Bir prop ile kontrol edilir; sadece gerektiğinde render edilir.

### 3.5 Dashboard Ana İçerik — Melontik Yoğunluğu

`apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx`

Mevcut layout silinip yeniden inşa edilir. Yeni section sırası:

1. **PageHeader** (yukarıda tanımlı; bell + period + meta).
2. **KPI Grid** — 5 sütunlu (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`).
   - Ciro / Maliyetli Ciro / Net Kâr / Kâr–Satış Oranı / İade
   - Mevcut `KpiTile` + `StatGroup` + `TrendDelta` reuse.
   - **Ekleme:** her tile'ın arka planında lite sparkline (yeni opt-in prop `sparkline` to `KpiTile`).
3. **Cost Breakdown** — 1 satır.
   - Sol: donut chart (shadcn `chart` primitive — Recharts).
   - Sağ: 8 kategori grid (`grid-cols-4 sm:grid-cols-2`): Ürün maliyeti, Komisyon, Kargo, Hizmet bedeli, Uluslararası hizmet, Stopaj, Net KDV, Diğer.
   - Yeni feature component: `features/dashboard/components/cost-breakdown-card.tsx`.
4. **Profit Trend + Product Metrics** — 2 sütunlu (`grid-cols-1 lg:grid-cols-3` → trend 2 col, metrik 1 col).
   - Sol: line chart (area gradient), tarih range selector PageHeader'dan gelen state'i okur.
   - Sağ: `ProductMetricsCard` — Net satış / Ort. kâr / Ort. kargo / Komisyon / İndirim oranı.
   - Yeni: `features/dashboard/components/profit-trend-card.tsx`, `product-metrics-card.tsx`.
5. **Net Profit Funnel + Order Metrics** — 2 sütunlu.
   - Sol: funnel chart (Recharts ya da custom SVG; özel bir primitive mevcut değil, custom SVG önerilir — basit).
   - Sağ: `OrderMetricsCard` — Sipariş / Ort. satış / Ort. kâr.
   - Yeni: `net-profit-funnel-card.tsx`, `order-metrics-card.tsx`.
6. **Top Profitable / Loss-making Products** — 2 sütunlu mini liste.
   - `top-products-card.tsx` — başlığı parametrik (en karlı | en zararlı).
   - Liste item'ları: ürün adı + delta tutarı (yeşil / kırmızı). Tıklanınca product detail.
7. **(Conditional) Empty / loading / error states** — `EmptyState` reuse; her section kendi skeleton'ını yönetir.

**Veri kaynakları:** Tüm metrikler `useDashboardMetrics(orgId, storeId, period)` adlı yeni hook altında toplanır (`features/dashboard/hooks/`). Single endpoint olabilir veya birden çok hook'a parçalanır — backend spec'te netleşir. Bu spec **frontend yapısını** tanımlar.

### 3.6 Per-page Sub-nav Konfigürasyonu

`apps/web/src/components/layout/nav-config.ts` genişletilir:

- Her `NavItem`'a opsiyonel `sections` (mevcut), her item'a opsiyonel `count` ve `tone` (`'warning' | 'info'`).
- Dashboard için sections yerine yeni alan: `meta: 'store-summary-period'` (compute side'da `ContextRail` bu meta'yı görüp `<DashboardContextMiddle />` render eder).
- Reconciliation, Expenses, Settings için sections eklenir (yukarıdaki tabloya göre).

Konfigurasyon büyüdüğü için `nav-config.ts` 200+ satır olabilir — okunabilirlik için section'lar dosya içinde gruplanır.

## 4. Responsive Davranış

| Breakpoint              | Icon Rail | Context Rail      | Main                | Notification Bell   |
| ----------------------- | --------- | ----------------- | ------------------- | ------------------- |
| `>= lg` (1024px+)       | Visible   | Visible (220px)   | 1fr                 | PageHeader actions  |
| `md` to `lg` (768–1024) | Visible   | Visible (220px)   | 1fr                 | PageHeader actions  |
| `< md` (mobile)         | Hidden    | Hidden (Sheet'te) | Full width, top bar | Top bar (yanına ☰) |

**Mobile top bar** (yeni component `layout/mobile-top-bar.tsx`):

- Sol: Hamburger button → açar `MobileNavSheet` (içinde IconRail nav items + ContextRail içeriği — store switcher / sub-nav).
- Orta: Logo veya page title (PageHeader gizli mobilde, content kendi başlığını render eder).
- Sağ: NotificationBell + UserMenu trigger.

Shadcn `Sheet` primitive (mevcut `ui/sheet.tsx`) kullanılır. Mobile breakpoint `< md` (Tailwind default).

**KPI grid mobile davranışı:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` (5 → 2 → 1).

**Touch targets:** CLAUDE.md kuralına uy — `pointer-coarse:size-11` icon button'lar için (mobile, tablet).

## 5. Reusing Existing Patterns / Primitives

| İhtiyaç                   | Mevcut çözüm                      | Aksiyon                                                          |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Store switcher            | `layout/store-switcher.tsx`       | Hafif styling güncellemesi (daha prominent kart)                 |
| KPI tile                  | `patterns/kpi-tile.tsx`           | `sparkline` opt-in prop ekle                                     |
| KPI grid                  | `patterns/stat-group.tsx`         | Reuse (5-col destek için class güncelle)                         |
| Trend delta               | `patterns/trend-delta.tsx`        | Reuse                                                            |
| Date range picker         | `patterns/date-range-picker.tsx`  | Reuse — PageHeader actions'a yerleştir                           |
| Page header               | `patterns/page-header.tsx`        | Reuse — actions slot'a bell + period                             |
| Sync badge                | `patterns/sync-badge.tsx`         | Reuse — meta slot'ta kalır                                       |
| Empty state               | `patterns/empty-state.tsx`        | Reuse — section-level skeleton/error için                        |
| Currency display          | `patterns/currency.tsx`           | Reuse                                                            |
| Marketplace logo          | `patterns/marketplace-logo.tsx`   | Reuse — store switcher kartında                                  |
| Sub-nav (rail middle)     | —                                 | **Yeni**: `patterns/sub-nav-list.tsx`                            |
| Dashboard period presets  | —                                 | **Yeni**: `features/dashboard/components/period-preset-list.tsx` |
| Store summary card (rail) | —                                 | **Yeni**: `features/dashboard/components/store-summary-card.tsx` |
| Rail warning card         | —                                 | **Yeni**: `patterns/rail-warning-card.tsx`                       |
| Notification bell         | —                                 | **Yeni**: `patterns/notification-bell.tsx`                       |
| Mobile top bar            | —                                 | **Yeni**: `layout/mobile-top-bar.tsx`                            |
| Mobile nav sheet          | —                                 | **Yeni**: `layout/mobile-nav-sheet.tsx`                          |
| Cost breakdown chart      | shadcn `chart` (Recharts)         | Compose into `cost-breakdown-card.tsx`                           |
| Profit trend chart        | shadcn `chart`                    | Compose into `profit-trend-card.tsx`                             |
| Funnel chart              | yok                               | Custom SVG (basit, ~30 satır)                                    |
| User menu theme toggle    | shadcn `toggle-group`             | Compose into UserMenu                                            |
| User menu language toggle | mevcut `LanguageSwitcher` mantığı | UserMenu'ye gömülü hale getir                                    |

shadcn primitive'lerinden kullanılacaklar: `popover`, `dropdown-menu`, `sheet`, `command`, `tabs`, `toggle-group`, `chart`, `tooltip`, `avatar`, `badge`, `separator`, `scroll-area`, `dialog` (kbd shortcuts için). Tümü mevcut.

## 6. Files: Create / Modify / Delete

### Create

- `apps/web/src/components/patterns/sub-nav-list.tsx` — generic sub-nav with count badges
- `apps/web/src/components/patterns/rail-warning-card.tsx` — conditional warning card
- `apps/web/src/components/patterns/notification-bell.tsx` — bell + popover + count
- `apps/web/src/components/layout/mobile-top-bar.tsx` — mobile shell top bar
- `apps/web/src/components/layout/mobile-nav-sheet.tsx` — mobile drawer (icon nav + context)
- `apps/web/src/features/dashboard/components/store-summary-card.tsx`
- `apps/web/src/features/dashboard/components/period-preset-list.tsx`
- `apps/web/src/features/dashboard/components/cost-breakdown-card.tsx`
- `apps/web/src/features/dashboard/components/profit-trend-card.tsx`
- `apps/web/src/features/dashboard/components/net-profit-funnel-card.tsx`
- `apps/web/src/features/dashboard/components/product-metrics-card.tsx`
- `apps/web/src/features/dashboard/components/order-metrics-card.tsx`
- `apps/web/src/features/dashboard/components/top-products-card.tsx`
- `apps/web/src/features/dashboard/hooks/use-dashboard-metrics.ts`
- `apps/web/src/features/dashboard/api/dashboard.api.ts` (placeholder — backend spec'i ayrı)
- `apps/web/src/app/[locale]/(dashboard)/notifications/page.tsx` (basit list page; iç tasarım sonraki spec)

### Modify

- `apps/web/src/components/layout/app-shell.tsx` — 3-col grid, ActivityRail kaldır, mobile top bar entegre
- `apps/web/src/components/layout/context-rail.tsx` — bottom kaldır, middle per-page render logic
- `apps/web/src/components/layout/store-switcher.tsx` — minor: prominent styling, status dot büyütme
- `apps/web/src/components/layout/nav-config.ts` — yeni `count`, `tone`, `meta` alanları
- `apps/web/src/features/auth/components/user-menu.tsx` — header + profile + theme + lang + help + logout
- `apps/web/src/components/patterns/kpi-tile.tsx` — opt-in `sparkline` prop
- `apps/web/src/components/patterns/page-header.tsx` — actions slot doc'unu güncelle (bell + period + refresh kullanımı)
- `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx` — yeni Dashboard layout
- `apps/web/messages/tr.json`, `en.json` — yeni i18n key'leri (`nav.notifications`, `userMenu.theme.*`, `userMenu.language.*`, `userMenu.help.*`, `dashboard.section.*`, vb.)

### Delete

- `apps/web/src/components/layout/activity-rail.tsx` — kaldırılır (component & styling & i18n key'leri)
- `apps/web/messages/tr.json`, `en.json` — `activityRail.*` key'leri silinir
- `apps/web/src/components/showcase/showcase-mocks.ts` — `MOCK_ACTIVITY` yedeği silinir / yer değiştirir (notifications için kullanılır)

### Untouched (varsa scope'ta değişmesin)

- `apps/web/src/components/layout/icon-rail.tsx` — yapısı korunur, sadece UserMenu içeriği zenginleşir (UserMenu kendi dosyasında)
- Tüm `apps/api` route'ları — bu spec frontend-only

## 7. Görsel Doğrulama

Brainstorm wireframe'leri `.superpowers/brainstorm/25301-1776806799/content/` altında saklı. **Final referans set** (bu spec ile birebir uyumlu):

- `current-state.html` — başlangıç durumu (problem framing)
- `q5-context-rail-adapts.html` — store switcher prominence + per-page sub-nav tablosu
- `q6-revised-no-scrollspy.html` — Dashboard rail tasarımı (store summary + period presets) + Desktop / Tablet / Mobile responsive breakdown
- `q7-final-shell.html` — final 3-col shell + UserMenu dropdown + bell PageHeader'da

Diğer dosyalar (q2/q3/q4) keşif aşamasının iz kayıtları; spec ile uyumsuz fikirler içerirler (scroll-spy, A+C context rail metrikleri vb.). Referans **olarak kullanılmaz** — yalnız brainstorm geçmişi olarak duruyor.

## 8. Risk ve Açık Sorular

1. **Theme provider bootstrap.** `next-themes` mount edilmiş mi henüz net değil — implement aşamasında doğrulanır. Mount edilmemişse root `[locale]/layout.tsx`'a eklenir (CLAUDE.md SSR-safety kuralları geçerli).
2. **Notification feed veri modeli.** Backend henüz `/v1/notifications` endpoint'i sunmuyor. İlk faz mock (showcase-mocks paterni); backend spec ayrı yazılır. Bell popover'ı boş state ile başlar gerekirse.
3. **Funnel chart.** Recharts'ın funnel modülü vs. custom SVG — implement tarafında basitlik için custom SVG seçilir (5 trapezoid layer, ~30 satır).
4. **Period preset URL state.** `nuqs` ile context rail ↔ PageHeader picker arasında two-way bind. Page reload'da preserve.
5. **Mobile sheet contents.** İlk versiyonda IconRail nav items + ContextRail içeriği aynı sheet'te alt alta. Sonraki iterasyonda tabbed olabilir — bu spec basit haliyle başlar.
6. **Per-page count veri kaynağı.** Sub-nav badge'leri (115, 12 vb.) cheap query'ler gerektirir. Backend spec'te `summary` endpoint'i tartışılır; ilk faz mock count.
7. **Settings page existence.** `/settings` route'u şu an yok — sub-nav stratejisi tanımlı ama route eklenene kadar context rail'de Settings için sub-nav görünmez.

## 9. Dahil Edilen Tasarım Kararları (recap)

1. **Activity rail kaldırıldı** — 32px persistent kolon az değer / çok chrome. Bell PageHeader'da yaşar.
2. **Sync button kaldırıldı** — context rail bottom'dan; per-page PageHeader actions'a taşındı (sadece manuel refresh izinli sayfalarda).
3. **+ Add Store** — store switcher dropdown'ın son item'ı (mevcut `onAddStore` zaten oradaydı, sadece bottom mirror silinir).
4. **Theme + Language → UserMenu** — single dropdown'da segmented toggle.
5. **Scroll-spy reddedildi** — rakipler kullanmıyor, sayfalar kısa-orta uzunlukta. Dashboard için store summary + period presets daha aksiyonlanabilir.
6. **Per-page sub-nav (Tiyasis count-tab paterni)** — her sayfaya tutarlı pattern.
7. **3-col shell** — daha geniş ana içerik, daha sade chrome.
8. **Mobile-first responsive** — Sheet + mobile top bar paterni.

## 10. Sonraki Adım

Bu spec onaylandıktan sonra `superpowers:writing-plans` skill'i ile **implementation plan** oluşturulur. Plan adımları yaklaşık şöyle olacak (sıralama plan aşamasında netleşir):

1. Activity rail silme + AppShell 3-col geçişi (mechanical refactor)
2. UserMenu genişletme (theme provider varsa direkt; yoksa önce mount)
3. SubNavList pattern + nav-config genişletme
4. ContextRail middle per-page render logic
5. StoreSummaryCard + PeriodPresetList
6. NotificationBell + PageHeader actions update
7. Dashboard ana içerik section'ları (8 yeni component, parallelizable)
8. Mobile top bar + nav sheet
9. i18n key migration + cleanup
10. Test coverage (component + hook tests, multi-tenancy isolation gerekirse)
