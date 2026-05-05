import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Raw HTML table primitives with shadcn defaults — sticky header,
 * tokenized row hover (`bg-surface-row-hover` from Phase 0), selected-
 * row state (`data-[state=selected]:bg-accent`), `data-numeric`
 * attribute for right-aligned tabular columns, and `data-pinned-side`
 * / `data-pinned-edge` attributes that turn cells into sticky pinned
 * columns with directional shadow. Use the DataTable pattern from
 * `patterns/` for any non-trivial table — it composes Table with
 * TanStack Table for sorting, filtering, selection, column visibility,
 * pagination, loading skeleton, empty state, and column pinning.
 *
 * Column pinning contract:
 *   data-pinned-side="left" | "right"   →  position: sticky on that edge
 *   data-pinned-edge="last-left" | "first-right"  →  edge shadow
 * Caller supplies the `left:` / `right:` offset via inline style so a
 * stack of multiple pinned columns lines up. Pinned cells get an opaque
 * background that mirrors the row state (hover + selected) via
 * `group/row` on TableRow.
 *
 * @useWhen rendering a static HTML table with no sorting or filtering needs (use the DataTable pattern from components/patterns for anything dynamic)
 */

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    // bg-muted is the design system's canonical "raised band" neutral
    // (--muted: oklch(94% 0.006 265) — tinted toward the brand hue at
    // the design-system-mandated 0.005-0.01 chroma). On a bg-card table
    // surface it gives the header zone clear visual separation from the
    // body without reading as a heavy gray panel. Same hue family as
    // every other neutral in the system.
    className={cn('bg-muted [&_tr]:border-border sticky top-0 z-10 [&_tr]:border-b', className)}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-border bg-surface-subtle border-t font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    // group/row exposes the row's hover + data-state to descendants so
    // pinned cells (which need an opaque bg of their own to keep
    // unpinned content from showing through) can mirror the row state
    // via group-hover/row:* and group-data-[state=selected]/row:*.
    className={cn(
      'group/row border-border duration-fast hover:bg-surface-row-hover data-[state=selected]:bg-accent border-b transition-colors',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

// Cells carrying `data-numeric` (on TH or TD directly) right-align + tabular-nums.
// Apply the rule on both cell types so numeric columns align across header and body.
//
// Pinning support: `data-pinned-side="left|right"` makes the cell sticky
// on that edge with an opaque background; `data-pinned-edge="last-left"`
// adds a shadow falling right (signalling unpinned content slides under),
// `data-pinned-edge="first-right"` mirrors the shadow falling left.
// Pinned TH sits at z-20 (above pinned TD at z-10 and above the sticky
// header row's own z-10) so the corner cell stays on top during both
// vertical and horizontal scroll.
export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'px-sm text-2xs text-muted-foreground h-10 text-left align-middle font-medium tracking-wide uppercase',
      'data-[numeric=true]:text-right',
      // Pinned cells use bg-muted to match the surrounding TableHeader
      // band, so a sticky pinned header column doesn't break out of the
      // header zone visually.
      'data-[pinned-side]:bg-muted data-[pinned-side]:sticky data-[pinned-side]:z-20',
      'data-[pinned-edge=last-left]:shadow-pin-left-edge data-[pinned-edge=first-right]:shadow-pin-right-edge',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      // py-sm gives content vertical breathing room — critical when a row
      // contains a tall element like a 56px product thumbnail, where
      // without padding the image would touch the row's border-b.
      // h-table-row-h still acts as the minimum so text-only rows
      // (price, stock, status) keep the established 44px row rhythm.
      'h-table-row-h px-sm py-sm text-foreground align-middle text-sm',
      'data-[numeric=true]:text-right data-[numeric=true]:tabular-nums',
      // Pinned body cells stay opaque so unpinned columns scrolling
      // beneath them don't show through; mirror the row's hover +
      // selected state via group/row variants on TableRow.
      'data-[pinned-side]:bg-card data-[pinned-side]:sticky data-[pinned-side]:z-10',
      'data-[pinned-side]:group-hover/row:bg-surface-row-hover',
      'data-[pinned-side]:group-data-[state=selected]/row:bg-accent',
      'data-[pinned-edge=last-left]:shadow-pin-left-edge data-[pinned-edge=first-right]:shadow-pin-right-edge',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-md text-muted-foreground text-sm', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';
