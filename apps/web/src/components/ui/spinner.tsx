import * as React from 'react';

import { cn } from '@/lib/utils';
import { type SizeKey, type ToneKey, toneTextClass } from '@/lib/variants';

/**
 * Spinner — a CSS rotating arc. By default it inherits `currentColor` (the
 * surrounding text color) and renders at `md` (16px) so it drops into Button /
 * Select / Input loading states unchanged. Pass `size` (sm 12px · md 16px · lg
 * 20px) for larger regions, or an explicit `tone` for a standalone status
 * indicator (e.g. a success spinner for async confirmation).
 *
 * Rotation is suppressed by the GLOBAL prefers-reduced-motion rule (continuous
 * functional motion is exempt from the system's transition tokens — it keeps
 * the native 1s linear spin); `role="status"` preserves the busy semantic so
 * AT still announces it. For page- or region-level loading prefer Skeleton
 * (it shapes the incoming content); reach for Spinner when the region is
 * smaller than a content shape.
 *
 * `label` provides the accessible name. Inside Button/Select it is supplied (or
 * the spinner is made aria-hidden with aria-busy on the control); standalone
 * callers should pass a translated `label`.
 *
 * @useWhen indicating in-flight async work inline within a small UI region (use Skeleton for page or region-level loading where the eventual layout matters)
 */

const SPINNER_SIZE: Record<SizeKey, string> = {
  sm: 'size-3',
  md: 'size-icon-sm',
  lg: 'size-5',
};

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Translated accessible label. Defaults to `'Loading'`. */
  label?: string;
  /** Arc diameter. Defaults to `md` (16px). */
  size?: SizeKey;
  /** Explicit arc color. Defaults to inheriting `currentColor` (the surrounding text). */
  tone?: ToneKey;
}

export function Spinner({
  className,
  label = 'Loading',
  size = 'md',
  tone,
  ...props
}: SpinnerProps): React.ReactElement {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none',
        SPINNER_SIZE[size],
        tone !== undefined ? toneTextClass[tone] : undefined,
        className,
      )}
      {...props}
    />
  );
}
