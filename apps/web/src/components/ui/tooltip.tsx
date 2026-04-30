'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Short hover/focus hint, single line of text or a key chord. Skipped
 * on touch devices (no hover) — never put critical information in a
 * tooltip alone. Mount `TooltipProvider` once at the app root with a
 * shared `delayDuration` so all tooltips feel consistent. For rich
 * preview content use HoverCard; for click-triggered panels use Popover.
 *
 * @useWhen surfacing short hint text on hover or focus (use HoverCard for rich preview content, never put critical info in a tooltip)
 */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'border-border bg-card px-xs py-3xs text-2xs text-foreground z-50 overflow-hidden rounded-md border shadow-md',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
