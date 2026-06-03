'use client';

import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Hover-triggered preview card with rich content — avatar + bio, link
 * URL preview, store summary on a row hover. Skipped on touch devices
 * (no hover); always design a fallback (Popover, inline expand, or a
 * dedicated detail page). For short text hints use Tooltip; for click-
 * triggered anchored panels use Popover.
 *
 * @useWhen showing a hover-triggered preview card with rich content (use Tooltip for short hint text, Popover for click-triggered panels)
 */

export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;

export const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => (
  // Portal to the top layer so a preview anchored inside an overflow-hidden
  // card or scroll area is never clipped — the one floating overlay that still
  // rendered inline.
  <HoverCardPrimitive.Portal>
    <HoverCardPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'border-border bg-popover p-md text-popover-foreground z-50 w-64 rounded-md border text-sm shadow-md',
        // Trigger-anchored origin + side-aware slide (panel tier -2, matching
        // Popover, its content twin) — the rich-preview build-out the thin
        // re-export was missing.
        'origin-[var(--radix-hover-card-content-transform-origin)]',
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
  </HoverCardPrimitive.Portal>
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;
