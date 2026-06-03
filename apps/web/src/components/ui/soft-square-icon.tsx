import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { type ToneKey, toneOutlineClass, toneSolidClass, toneSurfaceClass } from '@/lib/variants';

/**
 * Semantic-filled rounded-square icon badge — the small colored chip that
 * fronts a KPI status row, a quota tile, or a settings panel item
 * (Linear / Vercel dashboard vocabulary). It carries an icon on a tone
 * surface so a metric reads at a glance without a full Badge.
 *
 * Three fills via `variant`:
 *   - `solid` (default): saturated `bg-<tone>` + `-foreground` icon — the
 *     loud, attention-drawing chip (success / warning / destructive / info
 *     status icons). One per card; accent stays rare.
 *   - `soft`: pale `bg-<tone>-surface` + tone-colored icon — the quiet chip;
 *     `neutral` soft is the canonical monochrome `bg-muted` icon used on
 *     usage / quota tiles.
 *   - `outline`: transparent fill + tone border + tone icon — the lightest
 *     chip (a StatCard's decorative metric icon, where a fill would compete
 *     with the value).
 *
 * `shape` is `square` (default, `rounded-md`) or `circle` (`rounded-full`) — the
 * name is historical; it carries both. A circle outline is the dashboard
 * stat-card icon vocabulary (Stripe / Ramp).
 *
 * Decorative by default (`aria-hidden`): the adjacent label carries the
 * meaning — color is never the only signal in PazarSync. Pass
 * `aria-hidden={false}` + an `aria-label` only when the icon stands alone.
 * Shadowless by design — it sits flat inside a Card, never floats.
 *
 * @useWhen fronting a KPI status row / quota tile / panel item with a small semantic icon chip (use Badge for a text chip, StatusDot for a bare dot)
 */

export const SOFT_SQUARE_ICON_VARIANTS = ['solid', 'soft', 'outline'] as const;
export type SoftSquareIconVariant = (typeof SOFT_SQUARE_ICON_VARIANTS)[number];

function softSquareIconToneClass(tone: ToneKey, variant: SoftSquareIconVariant): string {
  if (variant === 'solid') return toneSolidClass[tone];
  if (variant === 'outline') return `border ${toneOutlineClass[tone]}`;
  return toneSurfaceClass[tone];
}

const softSquareIconVariants = cva(
  'inline-flex shrink-0 items-center justify-center [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: 'size-8 [&_svg]:size-icon-sm',
        md: 'size-9 [&_svg]:size-icon',
        lg: 'size-11 [&_svg]:size-icon-lg',
      },
      shape: {
        square: 'rounded-md',
        circle: 'rounded-full',
      },
    },
    defaultVariants: { size: 'md', shape: 'square' },
  },
);

export interface SoftSquareIconProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof softSquareIconVariants> {
  /** Semantic tone. Default `neutral`. */
  tone?: ToneKey;
  /** `solid` = saturated fill; `soft` = pale surface + tone icon; `outline` = border + tone icon, no fill. */
  variant?: SoftSquareIconVariant;
}

export function SoftSquareIcon({
  tone = 'neutral',
  variant = 'solid',
  size,
  shape,
  className,
  children,
  ...props
}: SoftSquareIconProps): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        softSquareIconVariants({ size, shape }),
        softSquareIconToneClass(tone, variant),
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export { softSquareIconVariants };
