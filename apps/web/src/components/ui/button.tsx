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
 * `icon-sm` are square dimensions for icon-only buttons (which MUST be
 * given an `aria-label`). Variants: `default | secondary | outline |
 * ghost | link | destructive | success | warning` — filled variants are
 * flat (no shadow) so the global `:focus-visible` glow reads unobstructed;
 * a restrained `active:scale` carries the press state.
 *
 * Let the Button own the loading UX — don't hand-roll `disabled={pending}` +
 * a ternary label; that drops the Spinner, `aria-busy`, and the leading-icon
 * swap:
 *
 * @example
 * <Button loading={mutation.isPending} loadingText={t('common.saving')}>
 *   {t('common.save')}
 * </Button>
 *
 * @useWhen rendering an interactive trigger that may need a loading state, leading or trailing icon, or asChild composition into a link
 */

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-xs whitespace-nowrap font-medium transition duration-fast ease-out-quart pointer-coarse:min-h-11 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-icon-sm [&_svg]:shrink-0',
  {
    variants: {
      // Filled variants use a dedicated *-hover token (real lightness shift,
      // like --primary-hover) rather than opacity-90. The restrained press
      // (active:scale) lives on every variant EXCEPT `link` — scaling a text
      // link reads as a glitch, not a press.
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:scale-[0.97]',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent active:scale-[0.97]',
        // The secondary "surface" button: a white --card fill + hairline border so
        // it reads as a raised, tactile control on the tinted --background canvas
        // (matching inputs). bg-background would tint it the same as the page and
        // make it blend in / float; on a white surface it stays a clean bordered button.
        outline:
          'border border-border bg-card text-foreground hover:bg-muted hover:border-border-strong active:scale-[0.97]',
        ghost: 'text-foreground hover:bg-muted active:scale-[0.97]',
        link: 'text-primary underline-offset-4 hover:underline',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:scale-[0.97]',
        // Quiet destructive: red text only, tinted surface on hover — for a
        // low-emphasis destroy action that must not shout next to a primary
        // CTA (e.g. a header "Tabloyu sil" beside "Kaydet ve indir"). Keep it
        // behind a ConfirmDialog; the softness is intentional, not the guard.
        'destructive-ghost': 'text-destructive hover:bg-destructive-surface active:scale-[0.97]',
        success: 'bg-success text-success-foreground hover:bg-success-hover active:scale-[0.97]',
        warning: 'bg-warning text-warning-foreground hover:bg-warning-hover active:scale-[0.97]',
      },
      size: {
        sm: 'h-8 px-sm text-xs',
        md: 'h-10 px-md text-sm',
        lg: 'h-11 px-lg text-base',
        icon: 'size-10 min-w-10 pointer-coarse:size-11',
        'icon-sm': 'size-8 min-w-8 pointer-coarse:size-11',
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
  /** Translated aria-label for the loading spinner. When omitted the spinner is decorative (`aria-hidden`) — the button's `aria-busy` carries the busy state, so no untranslated string is ever announced. */
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
    loadingLabel,
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

  // For an icon-only button (no visible text label) fall back to the button's
  // own aria-label so the loading announcement still has a verb; otherwise the
  // spinner stays decorative and aria-busy carries the state.
  const ariaLabel = typeof rest['aria-label'] === 'string' ? rest['aria-label'] : undefined;
  const spinnerLabel =
    loadingLabel ?? (typeof size === 'string' && size.startsWith('icon') ? ariaLabel : undefined);

  return (
    <button
      ref={ref}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading === true ? true : undefined}
      {...rest}
    >
      {loading === true ? (
        <Spinner label={spinnerLabel} aria-hidden={!spinnerLabel || undefined} />
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
