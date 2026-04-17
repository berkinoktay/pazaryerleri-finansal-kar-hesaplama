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
