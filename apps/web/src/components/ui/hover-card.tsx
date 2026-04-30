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
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      'border-border bg-popover p-md text-popover-foreground z-50 w-64 rounded-md border text-sm shadow-md',
      'duration-base ease-out-quart',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
      className,
    )}
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;
