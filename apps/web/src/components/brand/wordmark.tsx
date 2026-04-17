import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Whether to show the "PazarSync" text alongside the mark. */
  withText?: boolean;
}

/**
 * Brand wordmark. Solid color Host Grotesk, never a gradient (gradient text
 * is banned in this product — financial trust signal, not decoration).
 */
export function Wordmark({
  withText = true,
  className,
  ...props
}: WordmarkProps): React.ReactElement {
  return (
    <span className={cn('gap-xs text-foreground inline-flex items-center', className)} {...props}>
      <Logo size="md" />
      {withText ? <span className="text-md font-bold tracking-tight">PazarSync</span> : null}
    </span>
  );
}
