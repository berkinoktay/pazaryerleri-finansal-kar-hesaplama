'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { Cancel01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Slide-over panel anchored to a screen edge (left / right / top / bottom).
 * Preserves the underlying page context — the user can see what's behind
 * the sheet and dismiss it without losing their place. Preferred over
 * Dialog when the user might want to compare the panel content with the
 * page beneath, or when the panel content is read-only detail rather
 * than a focused task.
 *
 * Width is capped by `--size-sheet` (24rem) on mobile and `--size-sheet-wide`
 * (28rem) at sm+; override with className when needed.
 *
 * `variant` controls how it meets the edge: `docked` (default) sits flush with
 * only the exposed inner corners rounded — keep this for edge-anchored
 * navigation like the mobile sidebar; `floating` pulls in by a narrow gap with
 * all corners rounded, a "floating card" better suited to detail panels.
 *
 * @useWhen presenting detail or actions in a slide-over panel that preserves the underlying page context (use Dialog for focused tasks that need full attention)
 */

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      // Shared --overlay-scrim token, NO blur: a Sheet's whole purpose is
      // comparing the panel with the page beneath, and blur fights that. Fade
      // rides the duration-slow clock so scrim + panel move on one timeline.
      'bg-overlay-scrim fixed inset-0 z-50',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'duration-slow ease-out-quart',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  // No bare `transition` here — it would animate every property; the slide is
  // driven by the data-state animate-in/out keyframes, tuned by duration-slow
  // + ease-out-quart only. `side` carries ONLY the slide direction; position,
  // size, border, and radius vary with `variant` and live in the compound
  // variants below (a side × variant matrix).
  'fixed z-50 gap-md bg-card p-lg shadow-lg ease-out-quart data-[state=open]:animate-in data-[state=closed]:animate-out duration-slow',
  {
    variants: {
      side: {
        top: 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom: 'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        right: 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
      },
      // docked (default): flush to the edge, only the exposed inner corners
      //   rounded — keeps the docked slide-over / nav identity (the Linear /
      //   Vercel side-panel pattern). Safe for the mobile sidebar nav.
      // floating: pulled in by a narrow --space-xs (8px) gap on every edge,
      //   all corners rounded — a "floating card" for detail panels. Don't use
      //   it for edge-anchored navigation, which should stay docked/full-bleed.
      variant: { docked: '', floating: '' },
    },
    compoundVariants: [
      // ---- docked: flush + inner-corner radius ----
      {
        side: 'right',
        variant: 'docked',
        class:
          'inset-y-0 right-0 h-full w-3/4 max-w-sheet border-l border-border rounded-l-lg sm:max-w-sheet-wide',
      },
      {
        side: 'left',
        variant: 'docked',
        class:
          'inset-y-0 left-0 h-full w-3/4 max-w-sheet border-r border-border rounded-r-lg sm:max-w-sheet-wide',
      },
      {
        side: 'top',
        variant: 'docked',
        class: 'inset-x-0 top-0 border-b border-border rounded-b-lg',
      },
      {
        side: 'bottom',
        variant: 'docked',
        class: 'inset-x-0 bottom-0 border-t border-border rounded-t-lg',
      },
      // ---- floating: narrow inset gap + full radius + all-side border ----
      {
        side: 'right',
        variant: 'floating',
        class:
          'inset-y-xs right-xs w-3/4 max-w-sheet border border-border rounded-lg sm:max-w-sheet-wide',
      },
      {
        side: 'left',
        variant: 'floating',
        class:
          'inset-y-xs left-xs w-3/4 max-w-sheet border border-border rounded-lg sm:max-w-sheet-wide',
      },
      {
        side: 'top',
        variant: 'floating',
        class: 'inset-x-xs top-xs border border-border rounded-lg',
      },
      {
        side: 'bottom',
        variant: 'floating',
        class: 'inset-x-xs bottom-xs border border-border rounded-lg',
      },
    ],
    defaultVariants: { side: 'right', variant: 'docked' },
  },
);

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', variant, className, children, ...props }, ref) => {
  const t = useTranslations('common');
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side, variant }), className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="text-muted-foreground hover:text-foreground right-md top-md p-2xs duration-fast ease-out-quart pointer-coarse:p-sm focus-visible:ring-ring absolute inline-flex items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
          <Cancel01Icon className="size-icon-sm" />
          <span className="sr-only">{t('close')}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('gap-3xs flex flex-col text-left', className)} {...props} />;
}

export function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('gap-xs flex flex-col-reverse sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-foreground text-lg font-semibold tracking-tight', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;
