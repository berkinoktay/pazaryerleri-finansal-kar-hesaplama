/**
 * Shared variant token maps.
 *
 * Any component that accepts a `radius` or `size` prop consumes these
 * lookups so the same user-facing prop value (`md`, `lg`, …) resolves
 * to identical token-backed classes everywhere. This is the single
 * source of truth — do not hand-roll a Tailwind `rounded-*` or
 * `h-*`/`text-*` combo in a component file.
 *
 * Adding a new step: extend the token layer (src/app/tokens/*.css) and
 * add the entry here. Tailwind v4 will pick up the new CSS variable
 * automatically; components that already consume the variant gain the
 * new value without changes.
 */

export const RADIUS_KEYS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;
export type RadiusKey = (typeof RADIUS_KEYS)[number];

export const radiusClass: Record<RadiusKey, string> = {
  none: 'rounded-none',
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  full: 'rounded-full',
};

/**
 * Generic primitive size scale.
 *
 * Size keys are shared across Button, Badge, Input, Select, Tabs,
 * Alert — every component that exposes a `size` prop. The actual
 * dimensional classes live in each component's CVA block, but the
 * **key names** are fixed here so a form can set `size="md"` on its
 * label, input, and button and get a coherent visual rhythm.
 */
export const SIZE_KEYS = ['sm', 'md', 'lg'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

/**
 * Height tokens per size — drives h-* on control-style primitives
 * (Button, Input, Select trigger, Tabs list).
 */
export const sizeHeightClass: Record<SizeKey, string> = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-11',
};

/**
 * Text size per control size. Raised vs the old scale so labels and
 * inputs read comfortably without zoom: sm=13, md=14, lg=15.
 */
export const sizeTextClass: Record<SizeKey, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

/**
 * Horizontal padding per size — keeps content gutters proportional.
 */
export const sizePaddingXClass: Record<SizeKey, string> = {
  sm: 'px-xs',
  md: 'px-sm',
  lg: 'px-md',
};

/**
 * Canonical semantic-tone vocabulary — the SINGLE source for which tones
 * exist and which token pairing each "shape" of a tone-bearing primitive
 * uses (Badge, Alert, Sonner, Progress, Spinner, StatusDot all key off this).
 *
 * The load-bearing contract (caused the 2026-05 badge-warning revert, see
 * apps/web/CLAUDE.md "Dark-mode discipline"):
 *   tinted surface = `bg-<tone>-surface` + `text-<tone>`
 *   solid fill     = `bg-<tone>`         + `text-<tone>-foreground`
 *   NEVER `text-<tone>-foreground` on `bg-<tone>-surface`.
 * Every `text-<tone>` here clears 4.5:1 on both neutral bg and its own
 * `-surface` in light + dark. Change one tone → change all six.
 */
export const TONE_KEYS = [
  'neutral',
  'primary',
  'success',
  'warning',
  'destructive',
  'info',
] as const;
export type ToneKey = (typeof TONE_KEYS)[number];

/** Tinted surface (chip / alert / toast): pale bg + readable tone text. */
export const toneSurfaceClass: Record<ToneKey, string> = {
  neutral: 'bg-muted text-foreground',
  primary: 'bg-primary-soft text-primary-soft-foreground',
  success: 'bg-success-surface text-success',
  warning: 'bg-warning-surface text-warning',
  destructive: 'bg-destructive-surface text-destructive',
  info: 'bg-info-surface text-info',
};

/** Solid fill (high-contrast chip / filled bar): saturated bg + foreground text. */
export const toneSolidClass: Record<ToneKey, string> = {
  neutral: 'bg-foreground text-background',
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  info: 'bg-info text-info-foreground',
};

/** Outline (tone border + tone text on a transparent surface). */
export const toneOutlineClass: Record<ToneKey, string> = {
  neutral: 'border-border text-foreground',
  primary: 'border-primary text-primary',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  destructive: 'border-destructive text-destructive',
  info: 'border-info text-info',
};

/**
 * Soft tone border — the calmer `-border` token (a pale, ~70%-lightness tint
 * of the tone) that firms up a TINTED surface without the loud saturation of
 * `toneOutlineClass`. Pairs with `toneSurfaceClass` on the high-emphasis
 * (`solid`) Alert. Neutral falls back to `border-strong`; primary has no
 * dedicated `-border` token so it borrows the saturated `border-primary`.
 */
export const toneSoftBorderClass: Record<ToneKey, string> = {
  neutral: 'border-border-strong',
  primary: 'border-primary',
  success: 'border-success-border',
  warning: 'border-warning-border',
  destructive: 'border-destructive-border',
  info: 'border-info-border',
};

/** Bare tone fill (progress range, status dot) — background only. */
export const toneFillClass: Record<ToneKey, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
};

/** Bare tone text/icon color (spinner, standalone icon). */
export const toneTextClass: Record<ToneKey, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  info: 'text-info',
};
