# design-sync notes — PazarSync

Project: **PazarSync Design System** (claude.ai/design, id `645b4e23-af00-4088-9895-4f979462ed25`).

## What this sync is

**75 components synced so far** (pilot 12 + Wave 2a 14 + Wave 3a 8 + Wave 3b 11 + Wave 4 8 charts + Wave 5 4 + Wave 6 2 + Wave 7 16). The DS is **not a standalone package**: it lives inside the Next.js app (`apps/web/src/components/ui` + `/patterns`, ~51 + ~65 files total). The remaining surface is tracked in `docs/plans/2026-06-23-design-sync-expansion-plan.md` (leftovers below).

- **Wave 7 (16 — simple primitives + patterns):** `Label Textarea Slider Toggle ToggleGroup RadioGroup Alert Breadcrumb Pagination Kbd Select AspectRatio` (general) · `SearchInput MoneyInput PercentageInput PageHeader` (patterns). All standard shadcn / pure — authored from known APIs, build + validate clean, spot-verified Select (overlay, `defaultOpen`+`cardMode`), MoneyInput, Pagination (i18n labels via provider). **`Select` is the only overlay here** → `cardMode:single`+viewport + `defaultOpen`. **`MoneyInput`/`PercentageInput` rendered UNCONTROLLED** (placeholder + symbol only) — their value type is decimal.js `Decimal`, and a preview-bundle `Decimal` could fail an `instanceof` check against the main-bundle `Decimal`; don't pass `value`/`defaultValue`. **Still deferred (domain-data shapes / feature-coupled / overlay-heavy):** `profit-breakdown`/`promotion-indicator`/`badge-with-overflow` (need exact `ProfitBreakdownData`/`PromotionDisplay` shapes), `calendar`/`combobox`/`date-range-picker`/`info-hint`/`confirm-dialog`/`image-modal` (overlay/portal, more setup), `Sidebar`/`sync-center`/`org-store-switcher`/`advanced-filter-menu` (feature/layout), `context-menu`/`navigation-menu` (no open prop / complex), `marketplace-logo`/`image-cell` (next/image public-asset), the DataTable sub-parts + chart internals (`chart`/`chart-shapes`/`chart-states`).

- **Wave 6 (2 — feature/query group):** `DataTable` (flagship — `@tanstack/react-table`, generic `columns`+`data` props, internal table; preview passes mock columns/rows with `cell` render-props using `row.original`; `cardMode:single`+wide viewport) · `FilterTabs` (controlled `value`/`options`/`onValueChange`). **Feasibility rule for this group:** syncable iff _controlled_ (value via props) AND no internal `useQuery`/fetch/`@/features` import. DataTable + FilterTabs qualify (neither imports nuqs/features). **Deferred (feature-coupled or un-mockable):** `Sidebar` (large layout primitive), `sync-center`/`org-store-switcher` (import `@/features/*` hooks), `AdvancedFilterMenu` (non-trivial `FilterFieldDef`/`FilterRow` shapes), DataTable sub-parts (`DataTableToolbar`/`Pagination`/`RowActions` — need a live table instance, internal to DataTable).

- **Wave 5 (4):** `StatCard` (next/link) · `MultiFileUpload` · `Form` (react-hook-form) · `Menubar`. **`next/*` stub mechanism (reuse for any next-dependent component):** `cfg.tsconfig` now points at `apps/web/.design-sync-build/tsconfig.ds.json` (baseUrl `..`), which keeps `@/*` AND aliases `next/link`/`next/image` to `apps/web/.design-sync-build/stubs/*`. The converter's `tsconfigPathsPlugin` resolves these for BOTH the main bundle and the preview compile, so real `next/link` (which throws `process is not defined` at bundle eval) never gets bundled. **Gotcha:** do NOT put a `"//"` comment key in tsconfig.ds.json — the plugin's comment-stripper mangles the `//` and breaks JSON.parse, silently dropping the alias (esbuild then auto-discovers the real `apps/web/tsconfig.json` for `@/`, so `@/` keeps working but `next/*` resolves to the real module → `process` crash). **`Form` preview** uses a `useForm()` harness inside the cell (`react-hook-form` is bundleable). **Deferred (3b + 5 leftovers):** `MarketplaceLogo` (next/image at a runtime `/brands/*.svg` public path — the asset isn't in the DS bundle, would render broken), `ContextMenu` (no `open` prop — event-triggered), `NavigationMenu` (complex hover/viewport mega-menu).

- **Wave 4 (8 charts, recharts):** `BarChart LineChart DonutChart RankingChart ComboChart` (axis-bearing) · `Sparkline DistributionBar ChartPeriodSelector` (inline). **recharts works via the bundle** — the preview imports the chart from `@pazarsync/web` (recharts is bundled once in `_ds_bundle.js`, ~2.3MB now), wraps it in a sized `<div className="h-72 w-full">`, and the axis charts use `cfg.overrides cardMode:single + viewport` so `ResponsiveContainer` has room. Verified: BarChart (semantic P&L colors), DonutChart (legend + center total), ComboChart (dual-axis ₺/%), DistributionBar, Sparkline (line/area/bars). Percent series pass the percent number directly (18.2 → 18%, not 0.18). The earlier pilot DistributionBar hang was importing ChartSwatch in the preview — NOT an issue now that charts come from the bundle.

- **Wave 3b (11):** `AlertDialog HoverCard Sheet Drawer` (overlay) · `Command InputOTP` (inline) · `Stepper InlineEdit FileUpload BottomDock Wizard` (patterns). Drawer is vaul (renders bottom drawer + drag handle under forced `open`); Sheet is a right-side panel; Wizard is controlled (`current` + no-op `onCurrentChange`). **3b leftovers deferred:** ContextMenu (no `open` prop), Menubar (low value), NavigationMenu (complex viewport), MultiFileUpload, Form (needs a react-hook-form harness in the preview).

- **Pilot (12):** `Button Badge Card Input` (`general`) · `Currency EmptyState TrendDelta MappedBadge SyncBadge TimeAgo CopyableValue StatStrip` (`patterns`).
- **Wave 2a (14, pure):** `Avatar Checkbox Switch Progress Skeleton Spinner Separator StatusDot Table CountBadge` (`general`) · `StatRow ProfitCell Banner DefinitionList` (`patterns`).
- **Wave 3a (8, overlay/interactive):** `Tabs Accordion Collapsible ScrollArea` (inline) · `Tooltip Popover DropdownMenu Dialog` (overlay) — all `general`.

**Overlay technique (Wave 3a, reuse for Wave 3b):** force the Radix Root open with `open` / `defaultOpen` / `defaultValue` in the preview, and set `cfg.overrides.<Name> = {"cardMode":"single","viewport":"WxH"}` so the portal renders inside the card instead of escaping. Verified: Dialog (modal+scrim), DropdownMenu/Popover/Tooltip (floating-ui positioned), Accordion (`defaultValue` opens one). Tooltip also needs its own `<TooltipProvider>` wrapper inside the preview. Inline ones (Tabs/Accordion/Collapsible/ScrollArea) need no override. ContextMenu has no `open` prop (event-triggered) → defer or skip its open state.

Adding a component = `cfg.componentSrcMap` entry + a re-export line in `apps/web/.design-sync-build/pilot-entry.tsx` + a `.design-sync/previews/<Name>.tsx`, then recompile CSS + rebuild (see Rebuild sequence) + re-upload (additive: full writes, empty deletes).

## How the build is wired (non-standard — read before rebuilding)

- **No dist / app-embedded DS** → we bundle from source via a hand-written entry, not synth-entry-over-`src/` (which would drag the whole app in). All scaffolding lives in `apps/web/.design-sync-build/` (committed except `compiled.css`):
  - `pilot-entry.tsx` — re-exports the 12 components + `PreviewProvider` (cfg.entry). **It must stay under `apps/web/`** so the converter's `--entry` walk-up resolves `PKG_DIR` to `@pazarsync/web`, not the monorepo root.
  - `preview-provider.tsx` — wraps previews in `NextIntlClientProvider` (tr.json messages + `FORMATS` presets). cfg.provider = `PreviewProvider`.
  - `preview-icons.tsx` — curated hugeicons re-export, merged onto the bundle via `cfg.extraEntries`. See the hugeicons gotcha below.
  - `tw-entry.css` + `compile-css.mjs` — Tailwind v4 compile (see CSS gotcha).
  - `fonts/*.woff2` — brand fonts (see Fonts).
- **Rebuild sequence (always both steps):**
  1. `cd apps/web && node .design-sync-build/compile-css.mjs` → regenerates `compiled.css` (cfg.cssEntry).
  2. `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules apps/web/node_modules --out ./ds-bundle`
     Then `node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check`.

## Gotchas (each cost a debugging cycle)

- **CSS is Tailwind v4 utility classes, not a shipped stylesheet.** `globals.css` is the _input_ to Tailwind; the component classes (`bg-card`, `p-md`, …) only exist after Tailwind scans the sources. `compile-css.mjs` runs `@tailwindcss/postcss` over `tw-entry.css` (which `@source`s `src/components` + `src/lib` + `.design-sync/previews`) → `compiled.css` → cfg.cssEntry. **Re-run the compile whenever component or preview class usage changes**, else new utilities are missing and cards render unstyled.
- **`@tailwindcss/postcss` + `postcss` are not hoisted** (pnpm). `compile-css.mjs` resolves them _through_ the plugin's own location — don't `import 'postcss'` directly.
- **hugeicons-react HANGS the preview compile** if imported directly inside a `.design-sync/previews/*.tsx` (esbuild + the 4000-export single-file ESM + the story-import policy plugin = effectively infinite). The main bundle tree-shakes it fine. **Fix in place:** previews import icons from `'@pazarsync/web'`; add any new icon to `apps/web/.design-sync-build/preview-icons.tsx` (it rides into the bundle via `cfg.extraEntries`). Never `import … from 'hugeicons-react'` in a preview.
- **Preview cells are FUNCTION exports**, not elements: `export const Story = () => <…/>`. A bare-element export is silently skipped ("no PascalCase exports").
- **LSP errors on preview/entry files are expected noise** — those dirs are outside any tsconfig and `@pazarsync/web` resolves only at preview-compile time. The build is the truth.
- **Groups are auto-derived from the src path**: `components/ui/*` → `general`, `components/patterns/*` → `patterns`. The 4 primitives land in `general`. To relabel, a `cfg.docsMap` frontmatter stub works but replaces the JSDoc-synthesized `.prompt.md` body — not worth it for now.

## Fonts

Host Grotesk + JetBrains Mono are fetched by `next/font` at runtime in the app, so the bundle ships none by default. We added them (variable woff2, OFL, from the Fontsource CDN) under `.design-sync-build/fonts/`, with `@font-face` + the `--font-host-grotesk` / `--font-jetbrains-mono` token definitions in `tw-entry.css`. latin-ext carries Turkish glyphs (ğ ş ı İ) **and** the lira sign `₺` (U+20BA). Verified loaded in-browser (`document.fonts.check("16px 'Host Grotesk'")` → true).

## Verification

Playwright/Chromium was **declined by the owner** (they review in their own browser), so `package-validate.mjs` runs with `--no-render-check` and there is no machine grading or `.render-check.json`. Instead, all 12 cards were screenshot-verified via the chrome-devtools tool against a local `http-serve` of `ds-bundle/`, and the owner reviews `ds-bundle/.review.html` + the live claude.ai/design project. If a future run installs Playwright, drop `--no-render-check` and the normal capture/grade loop applies.

## Known render warns (triaged — not gaps)

- `[TOKENS_MISSING]` for `--radix-*`, `--sidebar-width`, `--skeleton-width` — runtime-injected by Radix / inline styles; expected absent from the static stylesheet.
- `[RENDER_SKIPPED]` — from `--no-render-check` (see above).

## Re-sync risks (watch-list)

- **Fonts are pinned to a one-time CDN fetch.** The woff2 are committed, so re-sync is offline-reproducible, but they won't auto-update if Fontsource changes — fine, fonts are stable.
- **Build scaffolding is committed but gitignore-adjacent.** A fresh clone has everything except `compiled.css` (regenerated by step 1) and `.ds-sync/` (re-stage from the skill + `npm i esbuild ts-morph @types/react`).
- **Expanding the pilot** = add the component to `cfg.componentSrcMap` + a re-export line in `pilot-entry.tsx` + author `.design-sync/previews/<Name>.tsx`, then recompile CSS + rebuild. Watch for: components importing `next/*` (next/link in `stat-card`, `marketplace-logo`) — those need a stub or omission; chart components pull recharts (heavy); anything importing `@/features/*` drags app graph.
- **Conventions header** (`conventions.md`) enumerates token classes — re-validate them against the fresh `_ds_bundle.css` on any token-layer change.
