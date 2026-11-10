---
name: ui-design-system
description: UI design system toolkit for PazarSync. Generates OKLCH design tokens, enforces shadcn/ui + Tailwind v4 conventions, and encodes a modern, minimal, trust-inspiring aesthetic tuned for a financial analytics dashboard and its marketing site. Use when creating or extending the design system, making token or color decisions, or reviewing UI for craft and clarity.
---

# UI Design System — PazarSync

Professional toolkit for creating and maintaining the PazarSync design system on top of **shadcn/ui + Tailwind v4**.

This is a product-specific design skill, not a generic theme picker. Every token, component, and motion curve exists to serve one goal: a financial analytics interface that Turkish marketplace sellers trust with their revenue data.

## Design Direction

PazarSync serves sellers who rely on the product to understand their real profitability. The interface must signal precision, professionalism, and calm competence across both the dashboard and the marketing site.

The target aesthetic is **modern, minimal, UX-rich, trust-inspiring**:

- **Modern** — contemporary grotesque typography, generous whitespace, decisive hierarchy, restrained motion.
- **Minimal** — hairline borders over heavy shadows, ghost cards over filled blocks, restrained color usage. One dominant neutral, one accent, one semantic at a time per region.
- **UX-rich** — micro-interactions that carry information (trend deltas vs. yesterday, timestamp freshness, source indicators, progressive disclosure), skeleton screens, optimistic updates, inline edit-in-place rather than detached modals.
- **Trust-inspiring** — precise numeric display with right-aligned tabular columns, explicit timezones (GMT+3), currency symbols always shown, visible data lineage (last-sync time, source marketplace), no hype language, no gratuitous illustration.

Reference products in this lineage: **Linear, Stripe Dashboard, Vercel Dashboard, Notion's database views, Ramp, Mercury.** Look at these when making direction calls.

The dashboard is the core product — optimize for data density, scannability, and repeat-use fatigue resistance. The marketing site shares the same token system but breathes more: larger type, more whitespace, one or two well-earned moments of emphasis per section.

## Core Capabilities

- **OKLCH design token generation** — palette, type scale, 4pt semantic spacing, radius, motion, shadow — assigned to shadcn's CSS variable contract.
- **Component system architecture** — shadcn as the default primitive; custom components only when shadcn genuinely doesn't cover the need.
- **Responsive design** — container queries for components, viewport queries for page layout.
- **Accessibility compliance** — WCAG AA minimums, `:focus-visible` rings, touch targets ≥ 44px, `prefers-reduced-motion`.
- **Dual theme** — light (primary dashboard default) and dark (ops/evening use) as separate designs, not inversions.

---

## Typography

### Principles

- **Pick a typeface with character that fits the product voice.** For PazarSync the stack leans on restrained grotesques — **Host Grotesk** is the current body/display choice (confirmed). If adding a secondary face, pair only when contrast is genuine (serif + sans, geometric + humanist) and there's a real reason beyond "variety."
- **Modular scale with ≥ 1.25 ratio** between steps. A 5–7 step scale with real contrast beats an 11-step scale of near-identical sizes. Good ratios: 1.25, 1.333, 1.5.
- **Single family in multiple weights** is often stronger than two competing families. Use weight + size + color for hierarchy before reaching for a second typeface.
- **Numerics matter.** Tabular (monospaced) figures for any column of numbers — prices, percentages, counts. `font-variant-numeric: tabular-nums` on KPI values and table columns so digits align vertically.
- **Don't use monospace as shorthand for "technical."** Reserve it for actual code, IDs, and order numbers where character-by-character reading matters.
- **Don't set long body text in uppercase.** Uppercase is for short eyebrows and labels only.
- **Cap line length at 60–72ch.** Line-height scales inversely with measure — narrow columns need tighter leading, wide columns need more.
- **16px minimum body**, touch targets ≥ 44px for text links, `rem`/`em` for font sizes, never `user-scalable=no`.

### Headings in financial UIs

- The KPI **value** is the hero, not the label. Give the number visual priority (size + weight) over its caption.
- Pair each big numeric value with a small, muted context line: comparison to yesterday, percentage delta, timestamp, or source.
- Avoid decorative icons above every metric card — they add noise without signal in data-dense views. Use icons for navigation and semantic meaning (warning, info), not ornament.

---

## Color

### Work in OKLCH, not HSL

OKLCH is perceptually uniform — a 10% lightness jump looks like a 10% lightness jump. HSL lies to you. Format: `oklch(L C H)` where L is 0–100%, C is roughly 0–0.4, H is 0–360.

**Critical rule: as lightness approaches 100% or 0%, reduce chroma.** High chroma at extreme lightness reads as garish and degrades legibility of adjacent data. Darkest and lightest shades should have low chroma; peak chroma lives in the mid-lightness range.

### Tinted neutrals

Pure `oklch(50% 0 0)` grays look sterile. Tint your neutrals toward the brand hue with chroma 0.005–0.01 — barely perceptible, but it's the difference between "off-the-shelf" and "designed."

### 60-30-10 weight discipline

- **60%** neutral (backgrounds, surfaces, most text)
- **30%** secondary (secondary text, borders, subtle UI)
- **10%** accent (CTAs, focus states, a single emphasis per region)

Accents work **because they're rare**. In a dashboard, paint only the values that need attention in accent color — never entire cards. A green KPI card is weaker than a black value with a small green delta chip beside it.

### Semantic color for financial data

- **Positive** (profit, growth) — green, muted: `oklch(~55% 0.14 145)`. Reserved for gains and successful states.
- **Negative** (loss, decline) — red, muted: `oklch(~55% 0.19 27)`. Reserved for losses and destructive actions.
- **Warning** (missing data, partial info, action needed) — amber: `oklch(~72% 0.16 75)`.
- **Info** (neutral context, comparisons) — blue, muted: `oklch(~58% 0.13 240)`.

Never use all four in one region. A single amber chip against neutral cards draws the eye; four colored cards side-by-side reads as chaos.

### Color rules

- **Never use pure `#000` or pure `#fff`.** Darkest background `oklch(12–18% [small chroma] [brand hue])`, lightest just below 100% with matching small chroma.
- **Never use gray text on colored backgrounds.** For secondary text on a tinted surface, use a lighter/darker shade of the _surface color itself_. Gray-on-color is the most common WCAG breach and reads sloppy.
- **Never rely on color alone for meaning.** Pair with icon, weight, label, or sign (+/-, ↑/↓) so color-blind users get the same information.
- **Don't paint large surfaces in accent color.** An orange primary button is emphasis; an orange card background is decoration.
- **Avoid the generic SaaS palette clichés.** Do not ship: cyan-on-dark, purple-to-blue gradients, teal + magenta duotones, neon accents on deep navy. These combinations read as 2022-era template work and clash with a trust-inspiring financial product. If the palette sketch could belong to a random crypto dashboard or generic AI-startup landing page, redo it — pick a deliberate hue that ties back to PazarSync's brand, not a trending combination.

### Theme choice

Light mode is PazarSync's primary dashboard default — sellers work during daylight, data legibility matters. Dark mode is a separate design, not an inversion:

- Lighter surfaces (not shadows) for depth in dark mode
- Desaturate accents slightly at high lightness
- Reduce font weight (~350 vs 400) to compensate for halation
- Background `oklch(12–18% …)`, never pure black

### shadcn token mapping (the contract)

Define the palette by assigning OKLCH values to shadcn's existing CSS variables. Don't invent a parallel token system — shadcn components read these names.

```css
:root {
  /* primitives tinted toward brand hue at chroma ~0.006 */
  --background: oklch(99% 0.006 [brand-hue]);
  --foreground: oklch(16% 0.01 [brand-hue]);
  --muted: oklch(96% 0.006 [brand-hue]);
  --muted-foreground: oklch(42% 0.01 [brand-hue]);
  --border: oklch(92% 0.008 [brand-hue]);
  --ring: oklch(55% 0.14 [brand-hue]);

  /* brand */
  --primary: oklch(55% 0.16 [brand-hue]);
  --primary-foreground: oklch(98% 0.006 [brand-hue]);

  --accent: oklch(94% 0.02 [brand-hue]);
  --accent-foreground: oklch(22% 0.02 [brand-hue]);

  /* semantic for financial data */
  --destructive: oklch(55% 0.19 27);
  --destructive-foreground: oklch(98% 0.006 27);
  --success: oklch(55% 0.14 145);
  --warning: oklch(72% 0.16 75);
  --info: oklch(58% 0.13 240);

  --card: oklch(100% 0 0);
  --card-foreground: var(--foreground);
}

.dark {
  --background: oklch(14% 0.008 [brand-hue]);
  --foreground: oklch(96% 0.006 [brand-hue]);
  --muted: oklch(20% 0.008 [brand-hue]);
  --muted-foreground: oklch(68% 0.01 [brand-hue]);
  --border: oklch(24% 0.01 [brand-hue]);
  --ring: oklch(65% 0.12 [brand-hue]);
  --primary: oklch(68% 0.14 [brand-hue]);
  --primary-foreground: oklch(14% 0.008 [brand-hue]);
}
```

Expose to Tailwind v4 through `@theme`:

```css
@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* one line per shadcn token */
}
```

---

## Layout & Spacing

### Dashboard hierarchy

1. **Page header** — title + one-line intent + last-sync timestamp. No "Welcome to X" and no restating the sidebar label.
2. **Primary KPI row** — 3–6 tiles with the most-important current-period metrics, each paired with a comparison delta and timestamp context.
3. **Visualization** — chart, table, or timeline for the period view. One visual focus, not four competing ones.
4. **Detail tables / lists** — sortable, filterable, dense rows with tabular numerics.

Within each region, left-align. Reserve center alignment for empty states, hero moments on the marketing site, and modal content.

### Layout rules

- **Subtle borders over heavy shadows.** `border: 1px solid var(--border)` on cards. Shadow only when the element genuinely floats (popover, modal, floating action).
- **Don't wrap everything in cards.** Natural grouping comes from spacing and alignment. Cards are reserved for genuinely distinct, actionable regions — not default containers for "a thing on a page."
- **Don't nest cards inside cards.** Flatten with a divider, spacing, or subtle background tint.
- **Vary KPI tile sizes when the data hierarchy demands it.** A uniform grid of identical tiles is fine when items are truly equivalent. When one metric is the headline and others are supporting, scale it up (2-col span for the primary value) rather than shouting with color.
- **Don't reach for a modal** when an inline panel, sheet/slide-over, or undo toast would do. Modals interrupt; inline panels preserve context — especially valuable when the user is comparing data.
- **Translucency only when it shows real depth** relative to content behind. Not as decoration.
- **Numeric columns right-aligned, text left-aligned.** Mixed alignment kills scannability.

### 4pt semantic spacing scale

Scale: `4, 8, 12, 16, 24, 32, 48, 64, 96` px. Semantic token names, not pixel-named:

```css
@theme {
  --space-3xs: 4px;
  --space-2xs: 8px;
  --space-xs: 12px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 32px;
  --space-xl: 48px;
  --space-2xl: 64px;
  --space-3xl: 96px;
}
```

- **Prefer `gap` over margin** for sibling spacing — avoids margin collapse and keeps layout declarative.
- **Container queries for components** (`@container`), **viewport queries for page layout** (`@media`). A component should react to its container, not the window.
- **Self-adjusting grids** with `repeat(auto-fit, minmax(280px, 1fr))` over breakpoint-ladder grids where possible.
- **Touch targets ≥ 44px**, even when the visual is smaller (expand with padding or `::after`).
- **Vertical rhythm** — pick a base line-height and make vertical spacing a multiple of it so headings/bodies land on a shared rhythm.

---

## Motion

- **Animate only `transform` and `opacity`.** Never animate `width`, `height`, `padding`, `margin`, `top`, `left`, `color`, or any layout/paint property. Those trigger recalc on every frame.
- **For height animations, transition `grid-template-rows: 0fr → 1fr`** on the parent and let the child overflow clip. Do not transition `height` directly.
- **Exponential ease-out for entrances** — decelerates naturally, signals precision over playfulness:
  - `cubic-bezier(0.25, 1, 0.5, 1)` — ease-out-quart (default)
  - `cubic-bezier(0.22, 1, 0.36, 1)` — ease-out-quint
  - `cubic-bezier(0.16, 1, 0.3, 1)` — ease-out-expo
- **No bounce or elastic easing.** PazarSync is a financial product — overshoot reads as unserious. Reserve bouncy motion for consumer products with a different emotional register.
- **Duration hierarchy:**
  - 100–150ms: immediate feedback (button press, toggle)
  - 200–300ms: state transitions (menu, tooltip, dropdown)
  - 300–500ms: layout shifts (accordion, modal enter)
  - 500–800ms: full entrance (page load)
  - Exits: ~75% of entrance duration.
- **Stagger** via `animation-delay: calc(var(--i, 0) * 50ms)`, capped at ~500ms total.
- **`prefers-reduced-motion: reduce`** is mandatory. Offer crossfade alternatives; keep functional animation (spinners, progress) but flatten decorative motion.

Motion tokens:

```css
@theme {
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
}
```

---

## Interaction

- **One primary per region.** Establish hierarchy: primary → secondary → ghost / text. If everything is emphasized, nothing is.
- **Don't repeat information the user can already see.** No "Welcome to Settings" header on a page titled Settings. No intros that restate the heading.
- **Trust cues in the UI.** Show the last-sync timestamp on data-backed views. Show the source (marketplace name) and the timezone (GMT+3) explicitly. Label partial/estimated data distinctly from confirmed data.
- **Don't amputate mobile.** Adapt — collapse, reflow, progressive disclosure — but never hide critical functionality because "small screen." If it's critical on desktop, it's critical on mobile.
- **`:focus-visible` rings are mandatory.** Don't remove focus without replacing. Minimum 3:1 contrast, 2–3px thick, external offset. Rings must be independently viable from hover — keyboard users never see hover.
- **Eight states per interactive element**: default, hover, focus, active, disabled, loading, error, success. Design each; don't let the browser default them.
- **Forms**: real `<label>` elements (placeholders aren't labels). Validate on blur. Connect errors via `aria-describedby`. For financial inputs, show units (₺, %) and format hints before the user types.
- **Overlays**: prefer the Popover API / CSS anchor positioning / portal-to-top-layer. Avoid `position: absolute` inside `overflow: hidden`.
- **Optimistic updates + undo toast** for low-stakes actions beat confirmation dialogs. Confirmation is for irreversible operations (payments, cost edits that retro-recalculate historical profit).
- **Skeleton screens > spinners** for perceived performance, especially on first-load dashboards where 6+ tiles populate asynchronously.
- **Roving tabindex** for component-internal navigation (toolbar, menu, listbox); Tab moves between components, arrows move within.

---

## CSS discipline — hard bans

These patterns break the product's target aesthetic. Match against them in both generation and review and refuse.

### BAN 1 — Side-stripe borders on cards / alerts / callouts

`border-left` or `border-right` thicker than 1px, or `inset box-shadow` faking the same effect, is banned on cards, list items, callouts, and alerts. It adds visual noise in data-dense views and competes with semantic meaning carried by icons and value color.

```css
/* ❌ BANNED */
.alert {
  border-left: 4px solid var(--destructive);
}
.card {
  border-left: 4px solid #ff0000;
}
.callout {
  box-shadow: inset 4px 0 0 var(--info);
}

/* ✅ Full border + subtle surface tint */
.alert {
  border: 1px solid var(--border);
  background: var(--muted);
}

/* ✅ Background tint only, no stripe */
.callout-info {
  background: oklch(from var(--info) 96% 0.02 h);
  color: oklch(from var(--info) 30% 0.08 h);
}

/* ✅ Leading icon carries the semantic */
.alert {
  display: flex;
  gap: var(--space-xs);
  align-items: flex-start;
}
.alert::before {
  content: '!';
  font-weight: 700;
  color: var(--destructive);
}
```

### BAN 2 — Gradient text

`background-clip: text` (or `-webkit-background-clip: text`) combined with any gradient is banned. Hero headlines, brand wordmarks, KPI values — all solid color. Reasons: financial products signal trust with precise, stable type; gradient text competes with chart gradients where gradient actually encodes data; it degrades legibility at small sizes and in dark mode.

```css
/* ❌ BANNED */
.headline {
  background: linear-gradient(90deg, #a855f7, #3b82f6);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

/* ✅ Solid color, emphasis via weight, size, or a single accent span */
.headline {
  color: var(--foreground);
  font-weight: 700;
  font-size: var(--fs-3xl);
}
.headline em {
  color: var(--primary);
  font-style: normal;
  font-weight: 700;
}
```

### BAN 3 — Glassmorphism as decoration

Frosted translucent panels over unmotivated backgrounds read as decorative filler. Use translucency only when it genuinely shows depth relative to content behind (scrolling header over content, modal over page, peek-through layers), never on isolated cards sitting on a flat surface.

### BAN 4 — Celebratory animation on financial state changes

A profit update is not a party. Confirmation is a subtle color change, a check icon, and a toast — not confetti or sparkles. Reserve celebratory animation for genuine user milestones (onboarding completion, first sync successful) and keep it brief.

---

## Styling discipline — no one-off magic values

All spacing, color, typography, radius, shadow, and motion values in component code must come from the token system.

- **Never use Tailwind arbitrary-value syntax** in component code: `w-[347px]`, `text-[#3a2f1c]`, `mt-[23px]`, `bg-[oklch(0.6_0.2_280)]`, `duration-[237ms]`. If a value is needed, add it to the token system first, then consume it via a named utility.
- **Never hand-write `style={{ … }}`** with literal spacing, color, typography, radius, or easing values. Tokens only.
- **Never write one-off CSS rules** with literal hex codes, pixel values, or raw `oklch(…)` calls inside a component file. Those live in the token layer.
- **If the token system doesn't have the value you need, extend the token system.** Add a scale step, a semantic color, a new easing token — don't bypass.

### The one exception

Truly runtime-dynamic values — progress bars driven by a prop, drag/transform offsets, virtualized list positions, user-driven animation offsets — can use inline styles or runtime-set custom properties, because they genuinely cannot be tokenized. Flag these with a short comment so they don't get mistaken for a token violation:

```tsx
// runtime-dynamic: progress driven by sync state
<div style={{ width: `${progress}%` }} />

// runtime-dynamic: drag offset
<div style={{ transform: `translateX(${offset}px)` }} />
```

---

## shadcn/ui integration (the binding contract)

- Treat shadcn components as the **default building blocks**. Only build a custom component when shadcn genuinely doesn't cover the need (real new primitive, not a "branded" restyle of an existing one).
- **Use shadcn's CSS variable names as the contract.** Express the palette by assigning OKLCH values to `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--radius`. Don't invent parallel names.
- When extending shadcn (tinting neutrals, adding `--success`/`--warning`/`--info`), add to the existing token layer — never introduce a competing token set.
- Typography, spacing, and motion tokens live as CSS custom properties, then are exposed to Tailwind v4 via the `@theme` block so Tailwind utilities and shadcn components pick them up automatically. (On Tailwind v3, use `tailwind.config.ts`.)
- Component variants: before inventing a new variant, check whether the behavior is really a state or a hierarchy shift that can be expressed with an existing shadcn variant plus tokens.

---

## Key scripts

### `design_token_generator.py`

Generates a starting set of design tokens from a brand seed color.

**Usage**: `python scripts/design_token_generator.py [brand_color] [style] [format]`

- `brand_color`: hex or OKLCH seed
- `style`: `modern | classic | playful` — for PazarSync, use **`modern`** (aligns with the product direction). Review the output against this skill before committing.
- `format`: **`css`** for this project. The generator emits CSS custom properties that paste into `:root` / `.dark` against shadcn's token names.

**Provided as a starting point**:

- OKLCH palette seeds (verify chroma drops at extreme lightness, verify neutrals are tinted toward the brand hue, verify no pure `#000` / `#fff`)
- Modular typography scale
- 4pt semantic spacing scale (`--space-*`)
- Radius, shadow, motion tokens
- Responsive breakpoint suggestions

**Post-generation review checklist**:

1. Neutrals have chroma 0.005–0.01 tinted toward the brand hue — not pure gray.
2. No pure black or pure white anywhere.
3. No gradient text in any example component.
4. No side-stripe borders in any example component.
5. KPI examples use `font-variant-numeric: tabular-nums`.
6. Light and dark themes are both complete — dark is a separate design, not an `invert()` of light.
7. Semantic colors (`--success`, `--warning`, `--info`) defined, not just `--destructive`.
