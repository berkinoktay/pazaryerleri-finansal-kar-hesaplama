'use client';

import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * App-spanning system message strip. Lives at the top of the app
 * shell above the Sidebar header — for maintenance windows, billing
 * past-due, scheduled downtime, multi-day incidents. The reach is
 * what sets it apart from `Alert` (page or section-level inline
 * message) and `Toast` (transient confirmation that auto-dismisses).
 *
 * Use sparingly. A banner that's always present trains the user to
 * tune it out. The mental model: "this affects every screen until
 * resolved", not "this is a hint about this page".
 *
 * Tone vocabulary mirrors Alert / Badge / TrendDelta so cross-component
 * consistency holds. The `onDismiss` callback gives consumers a hook to
 * persist the dismissed state — typically via sessionStorage so it
 * comes back next visit, OR via a localStorage flag keyed by incident
 * id so a one-shot announcement actually stays gone. The pattern itself
 * doesn't persist anything — that's a feature concern.
 *
 * @useWhen surfacing a system-wide event that affects every screen until resolved (use Alert for page-level inline messages, Toast for transient confirmations)
 */

type BannerTone = 'info' | 'success' | 'warning' | 'destructive';

const TONE_CLASSES: Record<BannerTone, string> = {
  info: 'bg-info-surface text-info border-info-border',
  success: 'bg-success-surface text-success border-success',
  warning: 'bg-warning-surface text-warning border-warning-border',
  destructive: 'bg-destructive-surface text-destructive border-destructive-border',
};

const TONE_ICONS: Record<BannerTone, React.ComponentType<{ className?: string }>> = {
  info: InformationCircleIcon,
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  destructive: AlertCircleIcon,
};

export interface BannerProps {
  /** Semantic tone — drives bg + foreground + default icon. */
  tone?: BannerTone;
  /**
   * Override the leading icon. Pass `null` to opt out entirely.
   * Defaults to the tone-matched icon.
   */
  icon?: React.ReactNode | null;
  /** Short headline. */
  title: string;
  /** Optional one-line elaboration. */
  description?: string;
  /**
   * Trailing action slot — typically a `<Link>` or quiet
   * `<Button variant="ghost">`. Use to deep-link to the screen that
   * resolves the banner's cause (settings, billing, status page).
   */
  action?: React.ReactNode;
  /**
   * When provided, renders a dismiss button on the right and fires
   * this callback on click. The pattern itself does NOT persist
   * dismissal — wire localStorage / sessionStorage in the consumer
   * keyed by the incident id so a one-shot announcement actually
   * stays dismissed.
   */
  onDismiss?: () => void;
  /** Translated aria-label for the dismiss button. Defaults to `'Dismiss'`. */
  dismissLabel?: string;
  className?: string;
}

export function Banner({
  tone = 'info',
  icon,
  title,
  description,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
}: BannerProps): React.ReactElement {
  const ToneIcon = TONE_ICONS[tone];
  const iconNode =
    icon === null
      ? null
      : icon !== undefined
        ? icon
        : React.createElement(ToneIcon, { className: 'size-icon-sm' });

  return (
    <div
      role="status"
      className={cn(
        'gap-md px-lg py-sm flex w-full items-center border-b text-sm',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {iconNode !== null ? (
        <span className="[&_svg]:size-icon-sm flex shrink-0 items-center">{iconNode}</span>
      ) : null}
      <div className="gap-3xs flex min-w-0 flex-1 items-baseline">
        <span className="font-medium">{title}</span>
        {description !== undefined ? <span className="opacity-90">— {description}</span> : null}
      </div>
      {action !== undefined ? <div className="flex shrink-0 items-center">{action}</div> : null}
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
}
