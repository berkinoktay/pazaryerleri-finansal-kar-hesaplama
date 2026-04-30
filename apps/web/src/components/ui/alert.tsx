import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Page- or section-level message that surfaces a state the user should
 * notice (validation summary, sync result, partial-data notice). The
 * `tone` prop carries semantic meaning AND auto-selects a default
 * leading icon — pass `icon={null}` to opt out, or supply a custom
 * one. The dismiss affordance (`onDismiss`) widens its hit area under
 * `pointer-coarse:` so touch users still meet the 44px target.
 *
 * For app-level system messages (maintenance window, payment past due)
 * use the future `Banner` molecule instead — banners are sticky / page-
 * spanning, alerts are inline within content.
 *
 * @useWhen surfacing a page or section-level message in a semantic tone (info, success, warning, destructive); use the future Banner for app-spanning system messages
 */

const alertVariants = cva('relative flex w-full items-start gap-sm border [&_svg]:shrink-0', {
  variants: {
    tone: {
      neutral: 'border-border bg-muted text-foreground [&>[data-alert-icon]]:text-muted-foreground',
      info: 'border-transparent bg-info-surface text-info [&>[data-alert-icon]]:text-info',
      success:
        'border-transparent bg-success-surface text-success [&>[data-alert-icon]]:text-success',
      warning:
        'border-transparent bg-warning-surface text-warning [&>[data-alert-icon]]:text-warning',
      destructive:
        'border-transparent bg-destructive-surface text-destructive [&>[data-alert-icon]]:text-destructive',
    },
    size: {
      sm: 'px-sm py-xs text-xs',
      md: 'px-md py-sm text-sm',
      lg: 'px-lg py-md text-base',
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
  defaultVariants: { tone: 'neutral', size: 'md', radius: 'md' },
});

type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive';

const DEFAULT_TONE_ICONS: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  neutral: InformationCircleIcon,
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  destructive: AlertCircleIcon,
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Icon rendered on the left. If omitted, a tone-based default is used. Pass `null` to opt out. */
  icon?: React.ReactNode | null;
  /** When provided, renders an accessible dismiss button on the top right of the alert. */
  onDismiss?: () => void;
  /** Translated aria-label for the dismiss button. Defaults to `'Dismiss'`. */
  dismissLabel?: string;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>((props, ref) => {
  const {
    className,
    tone,
    size,
    radius,
    icon,
    onDismiss,
    dismissLabel = 'Dismiss',
    children,
    ...rest
  } = props;

  const resolvedTone: AlertTone = tone ?? 'neutral';
  const iconToRender =
    icon === null
      ? null
      : icon !== undefined
        ? icon
        : React.createElement(DEFAULT_TONE_ICONS[resolvedTone], { className: 'size-icon-sm' });

  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ tone, size, radius, className }))}
      {...rest}
    >
      {iconToRender !== null ? (
        <span data-alert-icon="" className="mt-3xs [&_svg]:size-icon-sm flex shrink-0 items-center">
          {iconToRender}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss !== undefined ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center',
            'rounded-xs opacity-70 hover:opacity-100',
            'duration-fast transition-opacity',
            'focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-0 focus-visible:outline-none',
            'p-2xs pointer-coarse:p-sm',
            '[&_svg]:size-icon-sm',
          )}
        >
          <Cancel01Icon />
        </button>
      ) : null}
    </div>
  );
});
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-3xs leading-tight font-semibold', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('opacity-90 [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { alertVariants };
