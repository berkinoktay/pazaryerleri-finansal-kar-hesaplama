'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Short hover/focus hint — a single line of text or a key chord. Skipped on
 * touch devices (no hover); never put critical information in a tooltip alone.
 * A clean bubble (no arrow — a bordered arrow never connects cleanly and reads
 * as a detached triangle; Linear/Vercel/Stripe all omit it), portaled to the
 * top layer so it is never clipped by an overflow-hidden ancestor, and zoomed
 * from the trigger-anchored origin with a small side-aware slide.
 *
 * `TooltipProvider` is mounted once at the app root with a shared
 * `delayDuration`; wrap a subtree in a local provider only to override the
 * delay. For a value readout that must follow a control during drag, control
 * the Tooltip's `open` prop instead of relying on hover (see Slider). For rich
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
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'border-border bg-card text-foreground px-xs py-3xs text-2xs z-50 overflow-hidden rounded-md border shadow-md',
        'origin-[var(--radix-tooltip-content-transform-origin)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
        'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
        'duration-fast ease-out-quart',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
