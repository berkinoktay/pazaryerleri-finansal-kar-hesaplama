'use client';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Cross-platform custom scrollbar for a constrained-height region.
 * Native browser scrollbars look inconsistent across OSes and intrude
 * into content; ScrollArea renders a thin OS-agnostic thumb that
 * matches the design system. Reach for it inside Sheet, Dialog, Popover,
 * or any container with a fixed max-height — don't apply it to the
 * page body (the global scrollbar is already token-styled in
 * globals.css).
 *
 * @useWhen rendering a custom scrollbar for a constrained-height region inside an overlay or panel (not for the page body)
 */

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner className="bg-transparent" />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

export const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none',
      orientation === 'vertical' && 'h-full w-2 border-l border-transparent',
      orientation === 'horizontal' && 'h-2 flex-col border-t border-transparent',
      className,
    )}
    {...props}
  >
    {/* Mirror the global page scrollbar: a 2px transparent border + bg-clip-content
        gives the appearance of a thinner pill with breathing room from content, and
        the thumb (not the wrapper) is what brightens on hover. */}
    <ScrollAreaPrimitive.ScrollAreaThumb className="bg-border-strong duration-fast ease-out-quart hover:bg-muted-foreground relative flex-1 rounded-full border-2 border-transparent bg-clip-content transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;
