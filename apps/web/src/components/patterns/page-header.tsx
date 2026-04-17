import { cn } from '@/lib/utils';

export interface PageHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Short, descriptive page title (Turkish). */
  title: string;
  /**
   * One-line intent statement. Never restates the title — explains context,
   * period, or scope. e.g. "Nisan 2026 dönemi · Trendyol mağazası"
   */
  intent?: string;
  /** Leading slot for breadcrumbs, back-button, or store chip. */
  leading?: React.ReactNode;
  /** Trailing slot for actions — primary button + optional secondaries. */
  actions?: React.ReactNode;
  /** Meta row under the title — typically a SyncBadge. */
  meta?: React.ReactNode;
}

/**
 * Inline page header — no separate app-wide header bar exists in the
 * dual-rail layout. Each page owns its own header so context (store,
 * period, last sync) lives next to the content it describes.
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
      className={cn(
        'gap-md border-border pb-lg flex flex-col border-b',
        'sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="gap-2xs flex min-w-0 flex-col">
        {leading ? <div className="gap-xs flex items-center">{leading}</div> : null}
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
        {intent ? <p className="text-muted-foreground text-sm">{intent}</p> : null}
        {meta ? <div className="pt-3xs">{meta}</div> : null}
      </div>
      {actions ? <div className="gap-xs flex shrink-0 items-center">{actions}</div> : null}
    </header>
  );
}
