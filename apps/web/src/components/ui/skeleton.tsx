import { cn } from '@/lib/utils';

/**
 * Loading placeholder shaped like the content that will replace it.
 * The point is layout stability — set `width` / `height` (or use
 * Tailwind size utilities) to match the target content's dimensions
 * so there is no layout shift when real data arrives. `animate-pulse`
 * is automatically disabled under `prefers-reduced-motion`.
 *
 * Skeleton screens beat spinners for first-load dashboards: with 6+
 * tiles populating async, a single page-level spinner hides the
 * structure; per-tile skeletons preview it.
 *
 * @useWhen showing a per-region loading placeholder shaped like the content it will replace (prefer over a spinner for first-load views with multiple async tiles)
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}
