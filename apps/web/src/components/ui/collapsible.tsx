'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ArrowDown01Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Single show/hide toggle region — a standalone expandable detail block,
 * optional subform, or "Show advanced" disclosure. For multiple related
 * collapsible sections (FAQ list, settings groups), use Accordion instead so
 * the sibling-coordination behavior comes built in.
 *
 * `CollapsibleTrigger` ships a styled full-width row (neutral surface hover +
 * a chevron that rotates on open) so the common case needs no styling. Pass
 * `hideChevron` to drop the chevron, or `asChild` to hand a fully custom
 * element (a Button, a card header) — `asChild` is a clean pass-through and
 * keeps Radix's single-child contract.
 *
 * `CollapsibleContent` animates its height open/closed via the shared
 * `collapsible-down`/`collapsible-up` keyframes (the Radix idiom, driven by
 * `--radix-collapsible-content-height`); reduced-motion collapses it globally.
 * Content padding lives on an inner wrapper so the animated box stays
 * padding-free and the height tween reads cleanly.
 *
 * @useWhen toggling a single show/hide region with no sibling sections (use Accordion for related multiple collapsibles)
 */

export const Collapsible = CollapsiblePrimitive.Root;

export interface CollapsibleTriggerProps extends React.ComponentPropsWithoutRef<
  typeof CollapsiblePrimitive.CollapsibleTrigger
> {
  /** Hide the built-in chevron when supplying a custom affordance. Ignored with `asChild`. */
  hideChevron?: boolean;
}

export const CollapsibleTrigger = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
  CollapsibleTriggerProps
>(({ className, children, hideChevron = false, asChild = false, ...props }, ref) => {
  // asChild: the caller owns the element entirely (Slot merges props onto their
  // single child) — no styling or injected chevron, so the contract holds.
  if (asChild) {
    return (
      <CollapsiblePrimitive.CollapsibleTrigger ref={ref} asChild className={className} {...props}>
        {children}
      </CollapsiblePrimitive.CollapsibleTrigger>
    );
  }
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      ref={ref}
      className={cn(
        'gap-sm px-sm py-sm duration-fast flex w-full items-center justify-between rounded-md text-left text-sm font-medium transition-colors',
        'hover:bg-surface-subtle focus-visible:outline-none',
        '[&[data-state=open]>svg]:rotate-180',
        className,
      )}
      {...props}
    >
      {children}
      {hideChevron ? null : (
        <ArrowDown01Icon className="size-icon-sm text-muted-foreground duration-base ease-out-quart shrink-0 transition-transform" />
      )}
    </CollapsiblePrimitive.CollapsibleTrigger>
  );
});
CollapsibleTrigger.displayName = CollapsiblePrimitive.CollapsibleTrigger.displayName;

export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden"
    {...props}
  >
    <div className={className}>{children}</div>
  </CollapsiblePrimitive.CollapsibleContent>
));
CollapsibleContent.displayName = CollapsiblePrimitive.CollapsibleContent.displayName;
