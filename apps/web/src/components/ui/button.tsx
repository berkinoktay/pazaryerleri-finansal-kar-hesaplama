import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Button — the workhorse interactive primitive. Owns its own `loading`
 * (renders a Spinner in place of the leading icon, sets `aria-busy`,
 * and auto-disables to prevent double-submission), `leadingIcon` /
 * `trailingIcon` slots (auto-sized to `size-icon-sm`), and `asChild`
 * (renders into a Radix `Slot` so the styling applies to a custom
 * element — typically `<a>` from next/link).
 *
 * Sizes `sm | md | lg` align with Input and SelectTrigger; `icon` and
 * `icon-sm` are square dimensions for icon-only buttons.
 *
 * @useWhen rendering an interactive trigger that may need a loading state, leading or trailing icon, or asChild composition into a link
 */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-xs whitespace-nowrap font-medium transition-colors duration-fast focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-icon-sm [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent shadow-sm',
        outline:
          'border border-border bg-background text-foreground hover:bg-muted hover:border-border-strong',
        ghost: 'text-foreground hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90 shadow-sm',
      },
      size: {
        sm: 'h-8 px-sm text-xs',
        md: 'h-10 px-md text-sm',
        lg: 'h-11 px-lg text-base',
        icon: 'size-10',
        'icon-sm': 'size-8',
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
    defaultVariants: {
      variant: 'default',
      size: 'md',
      radius: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Auto-sized icon rendered before the button label. Ignored when `asChild` is true. */
  leadingIcon?: React.ReactNode;
  /** Auto-sized icon rendered after the button label. Ignored when `asChild` is true. */
  trailingIcon?: React.ReactNode;
  /** Shows a spinner in place of the leading icon; sets `aria-busy="true"`; auto-disables the button. Ignored when `asChild` is true. */
  loading?: boolean;
  /** Translated aria-label for the loading spinner. Defaults to `'Loading'`. */
  loadingLabel?: string;
  /** Optional label rendered in place of children while `loading` is true. */
  loadingText?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  const {
    className,
    variant,
    size,
    radius,
    asChild = false,
    leadingIcon,
    trailingIcon,
    loading,
    loadingLabel = 'Loading',
    loadingText,
    disabled,
    children,
    ...rest
  } = props;

  const classes = cn(buttonVariants({ variant, size, radius, className }));

  if (asChild === true) {
    return (
      <Slot ref={ref} className={classes} {...rest}>
        {children as React.ReactElement}
      </Slot>
    );
  }

  const isDisabled = loading === true || disabled === true;

  return (
    <button
      ref={ref}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading ?? undefined}
      {...rest}
    >
      {loading === true ? (
        <Spinner label={loadingLabel} />
      ) : leadingIcon !== undefined ? (
        leadingIcon
      ) : null}
      {loading === true && loadingText !== undefined ? loadingText : children}
      {loading !== true && trailingIcon !== undefined ? trailingIcon : null}
    </button>
  );
});
Button.displayName = 'Button';

export { buttonVariants };
