import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from 'hugeicons-react';
import * as React from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';
import { cn } from '@/lib/utils';
import { radiusClass, type RadiusKey, toneSoftBorderClass, toneSurfaceClass } from '@/lib/variants';

/**
 * Page- or section-level message that surfaces a state the user should
 * notice (validation summary, sync result, partial-data notice).
 *
 * DESIGN — surface-first, tone-as-accent. The alert sits on the same
 * `bg-card` surface as the cards around it (hairline border + ambient
 * `shadow-xs`) so it reads as a module that BELONGS to the page, not a
 * full-bleed colored slab pasted on top. The semantic color is concentrated
 * into a leading `SoftSquareIcon` medallion — the tone signals, the surface
 * stays calm. (No left accent bar — the color lives in the chip.)
 *
 * `emphasis` picks the treatment:
 *   - `subtle` (default): white card + soft tone medallion + neutral text.
 *     The everyday notice. The medallion + surface carry the weight, so the
 *     body text stays quiet (`text-muted-foreground`).
 *   - `solid`: the whole surface tints (`bg-<tone>-surface` + soft tone
 *     border + tone text) with a saturated medallion. RESERVE for genuinely
 *     high-stakes / irreversible notices (payment failed, bulk price write) —
 *     it is the loud exception, so its attention value never inflates.
 *
 * `tone` carries semantic meaning AND auto-selects a default leading icon —
 * pass `icon={null}` to opt out, or supply a custom one (it is sized by the
 * medallion). The dismiss affordance (`onDismiss`) widens its hit area under
 * `pointer-coarse:` so touch users still meet the 44px target.
 *
 * For app-level system messages (maintenance window, payment past due) use the
 * future `Banner` molecule instead — banners are sticky / page-spanning, alerts
 * are inline within content. Toast (`ui/sonner`) shares this exact anatomy for
 * transient messages, so a success toast and a success Alert read the same.
 *
 * @useWhen surfacing a page or section-level message in a semantic tone (info, success, warning, destructive); use the future Banner for app-spanning system messages
 */

type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive';
type AlertEmphasis = 'subtle' | 'solid';
type AlertSize = 'sm' | 'md' | 'lg';

const alertVariants = cva('relative flex w-full items-start border', {
  variants: {
    size: {
      sm: 'gap-xs px-sm py-xs text-xs',
      md: 'gap-sm px-md py-sm text-sm',
      lg: 'gap-sm px-lg py-md text-base',
    },
  },
  defaultVariants: { size: 'md' },
});

const DEFAULT_TONE_ICONS: Record<AlertTone, React.ComponentType<{ className?: string }>> = {
  neutral: InformationCircleIcon,
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  destructive: AlertCircleIcon,
};

// The medallion scales gently with the alert: the two common sizes share the
// restrained 32px chip; only the page-level `lg` alert grows it.
const MEDALLION_SIZE: Record<AlertSize, 'sm' | 'md' | 'lg'> = { sm: 'sm', md: 'sm', lg: 'md' };

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Semantic tone. Drives the medallion color and default icon. Default `neutral`. */
  tone?: AlertTone;
  /**
   * `subtle` (default): calm white-card surface + soft tone medallion.
   * `solid`: whole surface tints — reserve for high-stakes / irreversible notices.
   */
  emphasis?: AlertEmphasis;
  /** Corner radius. Default `lg`. */
  radius?: RadiusKey;
  /** Icon rendered inside the leading medallion. If omitted, a tone-based default is used. Pass `null` to opt out (drops the medallion). */
  icon?: React.ReactNode | null;
  /**
   * Legacy alias for `emphasis="solid"` — maps to the `solid` treatment (the
   * old "firm up the border" intent for high-stakes notices). Prefer
   * `emphasis`; an explicit `emphasis` always wins over `hasBorder`.
   */
  hasBorder?: boolean;
  /** Optional CTA rendered under the content. Owns its own Button so focus + layout stay in the primitive. */
  action?: { label: React.ReactNode; onClick: () => void; variant?: ButtonProps['variant'] };
  /** When provided, renders an accessible dismiss button on the top right of the alert. */
  onDismiss?: () => void;
  /** Translated aria-label for the dismiss button (no translated default — pass a next-intl string). */
  dismissLabel?: string;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>((props, ref) => {
  const {
    className,
    tone,
    emphasis,
    size,
    radius,
    icon,
    hasBorder = false,
    action,
    onDismiss,
    dismissLabel = 'Dismiss',
    children,
    ...rest
  } = props;

  const resolvedTone: AlertTone = tone ?? 'neutral';
  const resolvedEmphasis: AlertEmphasis = emphasis ?? (hasBorder ? 'solid' : 'subtle');
  const resolvedSize: AlertSize = size ?? 'md';

  // subtle → the alert matches the surrounding cards; the description is calm.
  // solid → the whole surface tints; title AND description use the full tone
  // color (hierarchy comes from the title's weight, not an opacity dim — the
  // sanctioned `text-<tone>` on `bg-<tone>-surface` pairing clears AA at full
  // opacity but not once dimmed, so we keep it at 1).
  const surfaceClass =
    resolvedEmphasis === 'solid'
      ? cn(toneSurfaceClass[resolvedTone], toneSoftBorderClass[resolvedTone])
      : 'bg-card border-border text-foreground shadow-xs [&_[data-alert-desc]]:text-muted-foreground';

  const iconToRender =
    icon === null
      ? null
      : icon !== undefined
        ? icon
        : React.createElement(DEFAULT_TONE_ICONS[resolvedTone]);

  return (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ size }), radiusClass[radius ?? 'lg'], surfaceClass, className)}
      {...rest}
    >
      {iconToRender !== null ? (
        <SoftSquareIcon
          tone={resolvedTone}
          variant={resolvedEmphasis === 'solid' ? 'solid' : 'soft'}
          size={MEDALLION_SIZE[resolvedSize]}
        >
          {iconToRender}
        </SoftSquareIcon>
      ) : null}
      <div className="min-w-0 flex-1">
        {children}
        {action !== undefined ? (
          <div className="mt-sm">
            <Button size="sm" variant={action.variant ?? 'outline'} onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
      {onDismiss !== undefined ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center',
            'rounded-xs opacity-70 hover:opacity-100',
            'duration-fast ease-out-quart transition-opacity',
            'focus-visible:shadow-focus focus-visible:outline-none',
            // 44px touch target under coarse pointers (p-sm padding only reached
            // 40px on the 16px icon); size-11 makes the hit area exactly 44px.
            'p-2xs pointer-coarse:size-11 pointer-coarse:p-0',
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
  <div
    ref={ref}
    data-alert-desc=""
    className={cn('leading-relaxed [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { alertVariants };
