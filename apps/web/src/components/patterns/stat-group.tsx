import { cn } from '@/lib/utils';

/**
 * Auto-fit grid for KPI tiles. Tiles grow to fill available width and
 * wrap once they'd fall below the minimum tile size (280px by default).
 * Container-aware: the grid reacts to its parent, not the viewport, so
 * embedding in a narrow column Just Works.
 */
export function StatGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn(
        'gap-md grid',
        'grid-cols-[repeat(auto-fit,minmax(var(--spacing-tile-min),1fr))]',
        className,
      )}
      {...props}
    />
  );
}
