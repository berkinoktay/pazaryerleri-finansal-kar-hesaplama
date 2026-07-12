import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
   * Inline status / context badge rendered next to the title (e.g. a validity
   * pill on a detail page). Keep it a single compact Badge — it shares the
   * heading's eye-line, so anything larger competes with the title.
   */
  badge?: React.ReactNode;
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
   * Meta slot — typically a SyncControl for data-freshness signaling. Its
   * placement depends on the variant and mode:
   * - Plain: inside the heading column, below the intent line, so context
   *   stacks title → intent → meta.
   * - Framed title mode: in the right cluster's TOP row — a status row that
   *   sits ABOVE the filters/actions controls row — so the freshness signal
   *   does not crowd the controls on a single line.
   * - Framed metric mode (`hero` present, ready/loading): inline on the
   *   identity row next to the small title; `intent` is not rendered there.
   */
  meta?: React.ReactNode;
  /**
   * Optional summary strip — a StatGroup of compact StatCards, rendered
   * full-width below the title/actions row. This is a SLOT, not a fixture:
   * omit it on pages without at-a-glance metrics and the header still reads
   * as complete (title + intent + actions form a finished unit). Never put a
   * single number here — it's for a row of related KPIs.
   */
  summary?: React.ReactNode;
  /**
   * Surface treatment. `'plain'` (default) renders the classic border-bottom
   * band — byte-identical to the pre-`variant` markup. `'framed'` wraps the
   * whole header (title band, optional filter-chip strip, and summary) in a
   * single raised Card, with the summary joined by a hairline divider.
   */
  variant?: 'plain' | 'framed';
  /**
   * Number-first ("metric") mode. Only meaningful with `variant='framed'` —
   * ignored under `'plain'`. When present with status `'ready'` or `'loading'`,
   * the title shrinks to a small identity (text-lg) and this hero value renders
   * large (text-5xl) beneath it; `intent` is NOT rendered in this mode — the
   * `caption` takes its place. Status `'empty'` or `'error'` falls back to the
   * title-first layout: the header NEVER prints a placeholder "₺0,00" or an
   * error string as the hero value — surfacing an error message is the
   * caller's job. `status` defaults to `'ready'` when omitted.
   */
  hero?: {
    value: React.ReactNode;
    caption?: React.ReactNode;
    status?: 'ready' | 'loading' | 'empty' | 'error';
    /**
     * Caller-translated accessible name for the loading region (e.g.
     * `t('common.loading')`). Keeps PageHeader i18n-free, mirroring
     * StatStrip's `loadingLabel`.
     */
    loadingLabel?: string;
  };
  /**
   * Page-scope filter controls (e.g. a DateRangePicker) — filters that also
   * recompute the summary/hero. Rendered in the right cluster, to the LEFT of
   * `actions` (`{filters}{actions}`). Works in both variants.
   */
  filters?: React.ReactNode;
  /**
   * Page-scope active-filter chips. Only rendered under `variant='framed'`, as
   * a thin strip between the title band and the summary — chips govern the
   * summary metrics, so they sit ABOVE them. Ignored under `'plain'`.
   */
  filterChips?: React.ReactNode;
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
 *   meta (SyncControl / freshness)
 *
 * The `intent` prop carries one-line context (period, scope, store) —
 * never restate the title; the sidebar already shows the section. Slot
 * the SyncControl into `meta` so freshness lives next to the heading it
 * describes. Slot the primary action (e.g. "Eşitle") into `actions`
 * so it's reachable in one glance from the top-right.
 *
 * `variant='framed'` lifts the whole header onto a single Card; add `hero`
 * for the number-first ("metric") mode where a star figure leads and the
 * title steps down to a small identity. Both are opt-in — the default
 * `'plain'` variant renders exactly as it always has.
 *
 * @useWhen anchoring a dashboard page with a title, optional context line, leading slot (breadcrumb), trailing actions, and a meta row (typically SyncControl)
 */
export function PageHeader({
  title,
  intent,
  badge,
  leading,
  actions,
  meta,
  summary,
  variant = 'plain',
  hero,
  filters,
  filterChips,
  className,
  ...props
}: PageHeaderProps): React.ReactElement {
  // Plain-variant right cluster: page-scope filters sit to the LEFT of actions
  // on a single row. When `filters` is omitted this reduces to today's markup.
  // The framed variant builds its own two-row cluster below (status row over a
  // controls row) once `resolvedMode` is known.
  const rightCluster =
    filters || actions ? (
      <div className="gap-xs flex shrink-0 flex-wrap items-center">
        {filters}
        {actions}
      </div>
    ) : null;

  // Title-first column — the classic stack (30px title + badge + intent, with an
  // optional meta row). `withMeta` governs whether the meta row (SyncControl /
  // freshness) stacks under the intent line: the plain variant keeps it here
  // (byte-identical to the pre-split markup), while framed's title mode drops it
  // (`false`) and re-renders it in the right cluster's status row instead.
  const renderTitleColumn = (withMeta: boolean): React.ReactElement => (
    <div className="gap-3xs flex min-w-0 flex-col">
      <div className="gap-sm flex flex-wrap items-center">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight">{title}</h1>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {intent ? <p className="text-muted-foreground max-w-prose-max text-sm">{intent}</p> : null}
      {withMeta && meta ? <div className="pt-2xs">{meta}</div> : null}
    </div>
  );

  if (variant === 'plain') {
    return (
      <header
        className={cn('border-border gap-sm pb-lg flex flex-col border-b', className)}
        {...props}
      >
        {leading ? (
          <div className="gap-xs text-2xs text-muted-foreground flex items-center">{leading}</div>
        ) : null}
        <div
          className={cn('gap-md flex flex-col', 'sm:flex-row sm:items-start sm:justify-between')}
        >
          {renderTitleColumn(true)}
          {rightCluster}
        </div>
        {summary ? <div className="min-w-0">{summary}</div> : null}
      </header>
    );
  }

  // Framed variant. Resolve the star-figure branch to a single readable mode:
  // - 'title'          → no hero, or hero present but 'empty'/'error' (fallback)
  // - 'metric'         → hero present + 'ready' → large value
  // - 'metric-loading' → hero present + 'loading' → value/caption skeletons
  const heroStatus = hero?.status ?? 'ready';
  const resolvedMode: 'title' | 'metric' | 'metric-loading' =
    hero === undefined || heroStatus === 'empty' || heroStatus === 'error'
      ? 'title'
      : heroStatus === 'loading'
        ? 'metric-loading'
        : 'metric';

  const framedLeftColumn =
    hero === undefined || resolvedMode === 'title' ? (
      renderTitleColumn(false)
    ) : (
      <div className="gap-2xs flex min-w-0 flex-col">
        <div className="gap-sm flex flex-wrap items-center">
          <h1 className="text-foreground text-lg font-semibold tracking-tight">{title}</h1>
          {badge}
          {meta}
        </div>
        {resolvedMode === 'metric-loading' ? (
          <div
            role="status"
            aria-busy={true}
            aria-label={hero.loadingLabel}
            className="gap-2xs flex flex-col"
          >
            <Skeleton className="h-2xl w-5xl" />
            <Skeleton className="h-sm w-4xl" />
          </div>
        ) : (
          <>
            <span className="text-foreground text-5xl leading-none font-semibold tracking-tight tabular-nums">
              {hero.value}
            </span>
            {hero.caption ? (
              <span className="text-muted-foreground text-sm">{hero.caption}</span>
            ) : null}
          </>
        )}
      </div>
    );

  // Framed right cluster: two rows. The status row (meta / SyncControl) sits ABOVE
  // the controls row (filters + actions) so the freshness signal reads clearly
  // instead of crowding the DateRangePicker + button on one line. The outer band
  // is already flex-col on mobile; `items-start sm:items-end` keeps the status
  // left-aligned on mobile and right-aligned on desktop. Meta only migrates here
  // in title mode — in metric mode it stays on the identity row next to the
  // small title and is NOT duplicated here.
  const metaInRightCluster = meta !== undefined && resolvedMode === 'title';
  const framedRightCluster =
    metaInRightCluster || filters || actions ? (
      <div className="gap-xs flex shrink-0 flex-col items-start sm:items-end">
        {metaInRightCluster ? <div className="flex">{meta}</div> : null}
        {filters || actions ? (
          <div className="gap-xs flex flex-wrap items-center">
            {filters}
            {actions}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <header className={cn('flex flex-col', className)} {...props}>
      <Card className="overflow-hidden">
        <div className="p-lg gap-sm flex flex-col">
          {leading ? (
            <div className="gap-xs text-2xs text-muted-foreground flex items-center">{leading}</div>
          ) : null}
          <div className="gap-md flex flex-col sm:flex-row sm:items-start sm:justify-between">
            {framedLeftColumn}
            {framedRightCluster}
          </div>
        </div>
        {filterChips ? (
          <div className="px-lg py-sm border-border-muted border-t">{filterChips}</div>
        ) : null}
        {summary ? (
          <>
            <div className="border-border border-t" />
            <div className="min-w-0">{summary}</div>
          </>
        ) : null}
      </Card>
    </header>
  );
}
