import { cn } from '@/lib/utils';

/**
 * Display a single keyboard key or shortcut hint (`⌘K`, `Esc`, `?`).
 * Renders as a uniform square cap (≈20px min-width, token-driven) so
 * single keys line up regardless of glyph width. The base
 * `bg-muted` / `text-muted-foreground` surface reads correctly
 * everywhere, including inside the now-`bg-card` Tooltip content slot.
 * Compose multi-chord shortcuts (e.g. `⌘ + K`) inside a `KbdGroup` so
 * the separator characters get consistent spacing.
 *
 * @useWhen displaying a keyboard key or chord hint inline (use KbdGroup to compose multi-key shortcuts with consistent spacing)
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'border-border bg-muted text-muted-foreground min-w-icon-lg px-3xs py-3xs text-2xs pointer-events-none inline-flex items-center justify-center rounded-xs border align-middle font-medium select-none',
        "[&_svg:not([class*='size-'])]:size-icon-xs",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="kbd-group"
      className={cn('gap-2xs inline-flex items-center', className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
