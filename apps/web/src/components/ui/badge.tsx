import { cva, type VariantProps } from 'class-variance-authority';
import { Cancel01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Badge — compact status / label chip.
 *
 * `tone` carries the semantic meaning (success, warning, etc.); `size`
 * scales vertical weight (sm is for table cells, lg is for hero stats).
 * `radius` is shared with the rest of the design system — set `full`
 * for pill, `md` for square-ish, etc.
 *
 * `leadingIcon` / `trailingIcon` auto-size their SVG to `size-icon-xs`
 * so the chip stays compact. `onRemove` renders an accessible dismiss
 * button on the right — use for filter chips, tags, etc.
 */

const badgeVariants = cva(
  'inline-flex items-center gap-3xs border font-medium transition-colors [&_svg]:size-icon-xs [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-foreground',
        primary: 'border-transparent bg-primary text-primary-foreground',
        outline: 'border-border bg-transparent text-foreground',
        success: 'border-transparent bg-success-surface text-success',
        destructive: 'border-transparent bg-destructive-surface text-destructive',
        warning: 'border-transparent bg-warning-surface text-warning',
        info: 'border-transparent bg-info-surface text-info',
      },
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
    defaultVariants: { tone: 'neutral', size: 'md', radius: 'full' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
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
    tone,
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
    <span className={cn(badgeVariants({ tone, size, radius, className }))} {...rest}>
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
            'duration-fast transition-opacity',
            'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-0 focus-visible:outline-none',
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
