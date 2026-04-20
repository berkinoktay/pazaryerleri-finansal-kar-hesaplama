import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Spinner — purely CSS rotating arc. Uses `currentColor` so it inherits
 * the surrounding text color and lives on `size-icon-sm` (16px) by default
 * to align with `[&_svg]:size-icon-sm` selectors on Button and Badge.
 *
 * Honors `prefers-reduced-motion` — rotation stops, `role="status"` keeps
 * the semantic signal intact so assistive tech still announces the busy
 * state.
 */
export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Translated accessible label. Defaults to `'Loading'`. */
  label?: string;
}

export function Spinner({
  className,
  label = 'Loading',
  ...props
}: SpinnerProps): React.ReactElement {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'size-icon-sm inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}
