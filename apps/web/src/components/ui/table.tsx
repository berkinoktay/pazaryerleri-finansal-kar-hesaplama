'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Raw HTML table primitives with shadcn defaults — sticky header,
 * tokenized row hover (`bg-surface-row-hover` from Phase 0), selected-
 * row state (`data-[state=selected]:bg-surface-row-selected` — a calm
 * low-chroma neutral, not the brand `--primary-soft`), `data-numeric`
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

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Wires the horizontal-scroll container to expose `data-can-scroll-left` /
   * `data-can-scroll-right` on its `group/tablescroll`, so pinned-column edge
   * shadows can react to the real scroll position — the shadow shows only on
   * the side where unpinned content actually slides under the pin (none at the
   * start/end of the scroll). Off for static tables; the DataTable pattern
   * turns it on.
   */
  scrollAware?: boolean;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scrollAware = false, ...props }, ref) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      if (!scrollAware) return;
      const el = scrollRef.current;
      if (el === null) return;
      const update = (): void => {
        const max = el.scrollWidth - el.clientWidth;
        el.toggleAttribute('data-can-scroll-left', el.scrollLeft > 1);
        el.toggleAttribute('data-can-scroll-right', max > 1 && el.scrollLeft < max - 1);
      };
      update();
      el.addEventListener('scroll', update, { passive: true });
      // Observe the container AND the inner table so a column-count change
      // (which alters scrollWidth without resizing the container) re-evaluates.
      const observer = new ResizeObserver(update);
      observer.observe(el);
      const inner = el.firstElementChild;
      if (inner !== null) observer.observe(inner);
      return () => {
        el.removeEventListener('scroll', update);
        observer.disconnect();
      };
    }, [scrollAware]);

    return (
      <div
        ref={scrollRef}
        className={cn('relative w-full overflow-auto', scrollAware && 'group/tablescroll')}
      >
        <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
      </div>
    );
  },
);
Table.displayName = 'Table';

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    // bg-surface-subtle is the light "header band" neutral
    // (--surface-subtle: oklch(96% 0.005 265) — one step below --muted,
    // tinted toward the brand hue). On a bg-card table surface it lifts the
    // header zone just enough to separate it from the body WITHOUT the
    // heavier `bg-muted` panel — the "başlığı biraz ayır, içerikle
    // karışmasın" call. It mirrors TableFooter (also bg-surface-subtle), so
    // header and footer read as symmetric light bands bracketing the rows.
    className={cn(
      'bg-surface-subtle [&_tr]:border-border sticky top-0 z-10 [&_tr]:border-b',
      // Header rows are TableRow instances and would inherit the body-row
      // hover tint. Today the coincidence of tones hid it; now that row
      // hover sits below the band tone, neutralize it structurally —
      // header rows are not interactive surfaces.
      '[&_tr]:hover:bg-transparent',
      className,
    )}
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
    //
    // State ladder (all named tokens, see colors.css LIGHTNESS LADDER):
    //   hover           → --surface-row-hover
    //   selected        → --surface-row-selected
    //   selected+hover  → --surface-row-selected-hover (EXPLICIT compound
    //                     rule — without it the winner between hover and
    //                     selected was Tailwind's internal variant sort
    //                     order, an implementation detail)
    //   expanded parent → bg-muted, matching the expanded sub-panel below
    //                     it so parent + panel read as one opened zone
    className={cn(
      'group/row border-border duration-fast border-b transition-colors',
      'hover:bg-surface-row-hover',
      // Press acknowledgment, gated on data-clickable (set by DataTable for
      // onRowClick rows) so plain rows don't flash while selecting text.
      // Doubly important on touch, where hover feedback never fires.
      'data-[clickable]:active:bg-surface-row-active',
      'data-[state=selected]:bg-surface-row-selected',
      'data-[state=selected]:hover:bg-surface-row-selected-hover',
      'data-[expanded]:bg-muted',
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
      // Sentence-case, muted, medium weight — uppercase + wide tracking read as
      // an admin-panel tell (and CSS-uppercasing mangles Turkish İ/ı); the
      // header band already separates the header zone from the body.
      'px-sm text-muted-foreground duration-fast h-10 text-left align-middle text-xs font-medium transition',
      'data-[numeric=true]:text-right',
      // Pinned cells use bg-surface-subtle to match the surrounding
      // TableHeader band, so a sticky pinned header column doesn't break out
      // of the header zone visually.
      'data-[pinned-side]:bg-surface-subtle data-[pinned-side]:sticky data-[pinned-side]:z-20',
      // Edge shadow is SCROLL-AWARE and lives in tokens/components.css as an
      // ::after overlay, NOT here: a box-shadow set on a <td>/<th> is silently
      // dropped under border-collapse: collapse (the table default), so a cell
      // utility class would render nothing. The CSS keys off data-pinned-edge
      // plus the Table's group/tablescroll data-can-scroll-* flags (scrollAware).
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
      // transition-colors/duration-fast MATCHES TableRow so a pinned cell's own
      // opaque background fades in lockstep with the row on hover/selection — it
      // was snapping instantly while the row faded, leaving a ~150ms seam.
      'h-table-row-h px-sm py-sm text-foreground duration-fast align-middle text-sm transition',
      'data-[numeric=true]:text-right data-[numeric=true]:tabular-nums',
      // Pinned body cells stay opaque so unpinned columns scrolling
      // beneath them don't show through; mirror the FULL row state ladder
      // via group/row variants on TableRow — every compound state the row
      // can paint must have a pinned mirror, or the pinned edge visibly
      // disagrees with the rest of the row.
      'data-[pinned-side]:bg-card data-[pinned-side]:sticky data-[pinned-side]:z-10',
      'data-[pinned-side]:group-hover/row:bg-surface-row-hover',
      'data-[pinned-side]:group-data-[clickable]/row:group-active/row:bg-surface-row-active',
      'data-[pinned-side]:group-data-[state=selected]/row:bg-surface-row-selected',
      'data-[pinned-side]:group-data-[state=selected]/row:group-hover/row:bg-surface-row-selected-hover',
      'data-[pinned-side]:group-data-[expanded]/row:bg-muted',
      // Edge shadow is SCROLL-AWARE and lives in tokens/components.css as an
      // ::after overlay, NOT here: a box-shadow set on a <td>/<th> is silently
      // dropped under border-collapse: collapse (the table default), so a cell
      // utility class would render nothing. The CSS keys off data-pinned-edge
      // plus the Table's group/tablescroll data-can-scroll-* flags (scrollAware).
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
