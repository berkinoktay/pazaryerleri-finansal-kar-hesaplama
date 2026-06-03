'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Anchored panel that opens on click and closes on outside click or
 * Escape. Use for short interactions that don't deserve a full Sheet
 * or Dialog — date pickers, color swatches, filter editors, "more
 * options" panels. For hover-triggered previews use HoverCard; for
 * short text hints use Tooltip.
 *
 * @useWhen presenting a click-triggered anchored panel for a short interaction (use HoverCard for hover previews, Tooltip for hint text, Sheet for full panels)
 */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Keep the panel off the viewport edges and let Radix flip/shift to the
      // side with room — the default that makes every popover open in a sane
      // spot without each call site hand-tuning placement. (No blanket
      // max-w/max-h cap here: it would clip popovers that intentionally
      // overflow — wide two-card filter menus, 2-month calendars — or whose
      // footer sits below a fixed-height scroll list. Consumers that need a
      // viewport cap opt in per-panel via the Radix available-size CSS vars.)
      collisionPadding={collisionPadding}
      className={cn(
        'border-border bg-popover p-md text-popover-foreground z-50 w-72 rounded-md border shadow-md',
        // Scale + slide grow FROM the trigger-anchored popper origin (Radix
        // exposes it as a CSS var), so the panel reads as emerging from its
        // trigger rather than popping from its own centre — the tooltip recipe.
        'origin-[var(--radix-popover-content-transform-origin)]',
        'duration-base ease-out-quart',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
