# PazarSync Design System — how to build with it

PazarSync is a financial dashboard for Turkish e-commerce marketplace sellers (Trendyol, Hepsiburada): orders, products, settlements, and real profit. The aesthetic is data-dense and trust-inspiring (Linear / Stripe / Ramp tier) — restrained, OKLCH palette tinted toward hue 265, Host Grotesk type. Build calm, scannable surfaces; never decorative.

## Styling idiom: Tailwind v4 utilities bound to design tokens

Style with the design system's **named token utilities only** — never arbitrary values (`bg-[#…]`, `p-[13px]`) and never a second palette. Every utility resolves to a CSS variable that swaps correctly in dark mode.

| Concern                    | Use these classes                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Surfaces                   | `bg-background` (page), `bg-card` (raised), `bg-muted` (subtle), `bg-input`                                          |
| Text                       | `text-foreground`, `text-muted-foreground`; weights `font-medium` / `font-semibold`                                  |
| Brand action               | `bg-primary` + `text-primary-foreground` (the one strong accent — use sparingly)                                     |
| Borders                    | `border-border`, `border-border-input`, `border-border-strong`                                                       |
| Semantic tone — chip/tint  | `bg-<tone>-surface` + `text-<tone>`                                                                                  |
| Semantic tone — solid fill | `bg-<tone>` + `text-<tone>-foreground`                                                                               |
| Type scale                 | `text-2xs` `text-xs` `text-sm` `text-base` `text-md` `text-lg` `text-xl` `text-2xl` `text-3xl`                       |
| Spacing (4pt scale)        | `gap-`/`p-`/`px-`/`py-`/`m-` + `3xs 2xs xs sm md lg xl 2xl 3xl …` (e.g. `p-lg`, `gap-sm`)                            |
| Radius                     | `rounded-sm` `rounded-md` `rounded-lg` `rounded-full`                                                                |
| Elevation                  | `shadow-xs` `shadow-sm` `shadow-md`                                                                                  |
| Width caps                 | `max-w-input` `max-w-form` `max-w-modal` `max-w-content-max` (never `max-w-md` — it collides with the spacing scale) |
| Numbers                    | `tabular-nums` on any figure that lines up in a column                                                               |

`<tone>` is one of `success` `warning` `destructive` `info`. The rule is strict: `text-<tone>` on `bg-<tone>-surface`, `text-<tone>-foreground` only on solid `bg-<tone>`. Mixing them produces near-invisible text.

## Composition rules

- **Money** always renders through `<Currency value={…} />` (TRY, `₺`, tabular) — never a hand-formatted number.
- **Percent deltas** use `<TrendDelta value={12.4} goodDirection="up" />` — set `goodDirection` so a cost metric going down reads green, not red.
- **Status** is a `<Badge tone="…">` or `<MappedBadge>`; **KPIs** are `<StatStrip>` or a `<Card>`.
- **Don't nest cards in cards** — separate regions with spacing or a divider first; reach for `Card` only when a region is genuinely standalone.
- Reuse the library component for any control; write your own JSX only for layout glue (flex/grid with the spacing tokens above).

## i18n context

The product is Turkish. A few components read locale + format presets from a `next-intl` provider that wraps the app (`SyncBadge`, `TimeAgo`, `CopyableValue`, `StatStrip`, and any future component using relative time / number formatting). In these previews that context is supplied automatically; when composing a screen, assume it exists at the app root.

## Where the truth lives

Read the bound stylesheet (`styles.css` and its `@import` closure — tokens + `_ds_bundle.css`) for the exact token values, and each component's `<Name>.prompt.md` + `<Name>.d.ts` for its API before composing it.

## Idiomatic example

```jsx
<Card>
  <CardHeader>
    <CardTitle>Mağaza Özeti</CardTitle>
    <CardDescription>Son 30 gün</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="gap-md flex items-baseline">
      <Currency value={284390.45} emphasis className="text-2xl" />
      <TrendDelta value={12.4} goodDirection="up" />
    </div>
    <div className="mt-sm gap-xs flex">
      <Badge tone="success">Teslim Edildi</Badge>
      <Badge tone="info">Kargoda</Badge>
    </div>
  </CardContent>
</Card>
```
