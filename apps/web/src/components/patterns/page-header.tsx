import { cn } from '@/lib/utils';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Short, descriptive page title (Turkish). */
  title: string;
  /**
   * One-line intent statement. Never restates the title — explains context,
   * period, or scope. e.g. "Nisan 2026 dönemi · Trendyol mağazası"
   */
  intent?: string;
  /**
   * Top-row slot — typically a Breadcrumb, back-button, or store chip.
   * Renders ABOVE the title in a muted micro-row so the heading stays
   * the visual anchor. Use sparingly: flat list pages don't need a
   * breadcrumb, only nested detail pages.
   */
  leading?: React.ReactNode;
  /**
   * Trailing action slot — primary button + optional secondaries. Sits
   * top-right of the title row, breathing in line with the heading.
   * Wraps below the title on mobile.
   */
  actions?: React.ReactNode;
  /**
   * Meta row inside the heading column — typically a SyncBadge for
   * data-freshness signaling. Appears below the intent line so context
   * stacks: title → intent → meta.
   */
  meta?: React.ReactNode;
}

/**
 * Inline page header — no separate app-wide header bar exists in the
 * shell, so each page anchors itself with title, optional context,
 * leading slot (breadcrumb / back link), trailing actions, and a meta
 * line for freshness. The hierarchy is intentional:
 *
 *   leading (small, muted)            — where am I?
 *   ─────────────────────────────────────────────────
 *   title (large, semibold)  · actions (right-aligned)
 *   intent (muted body)
 *   meta (SyncBadge / freshness)
 *
 * The `intent` prop carries one-line context (period, scope, store) —
 * never restate the title; the sidebar already shows the section. Slot
 * the SyncBadge into `meta` so freshness lives next to the heading it
 * describes. Slot the primary action (e.g. "Eşitle") into `actions`
 * so it's reachable in one glance from the top-right.
 *
 * @useWhen anchoring a dashboard page with a title, optional context line, leading slot (breadcrumb), trailing actions, and a meta row (typically SyncBadge)
 */
export function PageHeader({
  title,
  intent,
  leading,
  actions,
  meta,
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  return (
    <header
      className={cn('border-border gap-sm pb-lg flex flex-col border-b', className)}
      {...props}
    >
      {leading ? (
        <div className="gap-xs text-2xs text-muted-foreground flex items-center">{leading}</div>
      ) : null}
      <div className={cn('gap-md flex flex-col', 'sm:flex-row sm:items-start sm:justify-between')}>
        <div className="gap-3xs flex min-w-0 flex-col">
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">{title}</h1>
          {intent ? (
            <p className="text-muted-foreground max-w-prose-max text-sm">{intent}</p>
          ) : null}
          {meta ? <div className="pt-2xs">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="gap-xs flex shrink-0 flex-wrap items-center">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
