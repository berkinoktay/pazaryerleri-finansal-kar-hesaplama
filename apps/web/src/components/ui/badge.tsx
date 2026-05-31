import { cva, type VariantProps } from 'class-variance-authority';
import { Cancel01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { type ToneKey, toneOutlineClass, toneSolidClass, toneSurfaceClass } from '@/lib/variants';

/**
 * Badge — compact status / label chip.
 *
 * Tone and variant are ORTHOGONAL: `tone` is the semantic color
 * (neutral / primary / success / warning / destructive / info) and
 * `variant` is the treatment:
 *   - `surface` (default) — pale tinted chip (`bg-<tone>-surface` + `text-<tone>`).
 *     The dashboard default — the restrained "30" in 60-30-10.
 *   - `solid` — saturated fill (`bg-<tone>` + `text-<tone>-foreground`). The
 *     sparing "10" accent; reserve for the one chip that must dominate.
 *   - `outline` — tone border + tone text on a transparent surface.
 * All three read from the shared tone vocabulary in `@/lib/variants`, so
 * Badge is the template the other tone-bearing primitives copy.
 *
 * `radius` defaults to `md` (shared with Button/Input). Use `radius="full"`
 * for a dismissible filter/pill chip; keep `md` for inline status badges in
 * lists and tables. `size` scales vertical weight. `leadingIcon` /
 * `trailingIcon` auto-size their SVG to `size-icon-xs`. `onRemove` renders an
 * accessible dismiss button. For a "+N others" overflow chip use
 * BadgeWithOverflow from patterns/.
 *
 * Badge is display-only (a `<span>`); for status announcements wrap it in a
 * `role="status" aria-live="polite"` container — the reactivity is the
 * consumer's concern, not the chip's.
 *
 * @useWhen rendering a compact status, label, or filter chip with optional leading or trailing icon and optional dismiss button
 */

export const BADGE_VARIANTS = ['surface', 'solid', 'outline'] as const;
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

function badgeToneClass(tone: ToneKey, variant: BadgeVariant): string {
  if (variant === 'solid') return cn('border-transparent', toneSolidClass[tone]);
  if (variant === 'outline') return cn('bg-transparent', toneOutlineClass[tone]);
  return cn('border-transparent', toneSurfaceClass[tone]);
}

const badgeVariants = cva(
  'inline-flex items-center gap-3xs border font-medium transition-colors duration-fast ease-out-quart [&_svg]:size-icon-xs [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: 'px-xs py-3xs text-2xs',
        md: 'px-sm py-3xs text-xs',
        lg: 'px-sm py-3xs text-sm',
      },
      radius: {
        none: 'rounded-none',
        xs: 'rounded-xs',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        '2xl': 'rounded-2xl',
        full: 'rounded-full',
      },
    },
    defaultVariants: { size: 'md', radius: 'md' },
  },
);

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'>, VariantProps<typeof badgeVariants> {
  /** Semantic color. Defaults to `neutral`. */
  tone?: ToneKey;
  /** Treatment: `surface` (pale, default), `solid` (saturated), `outline`. */
  variant?: BadgeVariant;
  /** Decorative icon on the left. Inherits the badge's tone color. */
  leadingIcon?: React.ReactNode;
  /** Decorative icon on the right (hidden when `onRemove` is also provided). */
  trailingIcon?: React.ReactNode;
  /** When provided, renders an accessible dismiss button on the right. Use for filter chips / tags. */
  onRemove?: () => void;
  /** Translated aria-label for the remove button. Defaults to `'Remove'`. */
  removeLabel?: string;
}

export function Badge(props: BadgeProps): React.ReactElement {
  const {
    className,
    tone = 'neutral',
    variant = 'surface',
    size,
    radius,
    leadingIcon,
    trailingIcon,
    onRemove,
    removeLabel = 'Remove',
    children,
    ...rest
  } = props;

  return (
    <span
      className={cn(badgeVariants({ size, radius }), badgeToneClass(tone, variant), className)}
      {...rest}
    >
      {leadingIcon !== undefined ? <span className="flex items-center">{leadingIcon}</span> : null}
      {children}
      {onRemove === undefined && trailingIcon !== undefined ? (
        <span className="flex items-center">{trailingIcon}</span>
      ) : null}
      {onRemove !== undefined ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center',
            'rounded-full opacity-70 hover:opacity-100',
            'duration-fast ease-out-quart transition-opacity',
            // The brand glow reads on any tone (ring-current was near-invisible
            // on neutral/muted chips).
            'focus-visible:shadow-focus focus-visible:outline-none',
            'p-3xs pointer-coarse:p-xs',
            '-mr-3xs pointer-coarse:-mr-xs',
          )}
        >
          <Cancel01Icon />
        </button>
      ) : null}
    </span>
  );
}

export { badgeVariants };
