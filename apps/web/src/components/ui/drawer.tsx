'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '@/lib/utils';

/**
 * Bottom-anchored sheet with a draggable handle, optimized for touch
 * (powered by vaul). The body scales slightly behind it on open for
 * depth — set `shouldScaleBackground={false}` if your page layout
 * conflicts with the scale transform. Use Drawer over Sheet when the
 * primary input is touch and the dismiss gesture (swipe down) is part
 * of the UX. On desktop pointer-fine devices Sheet usually reads better.
 *
 * @useWhen presenting a touch-first bottom-anchored panel with swipe-to-dismiss (use Sheet for desktop-first slide-overs, Dialog for focused tasks)
 */

export const Drawer = ({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>): React.ReactElement => (
  <DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
Drawer.displayName = 'Drawer';

export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerPortal = DrawerPrimitive.Portal;
export const DrawerClose = DrawerPrimitive.Close;

export const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn(
      // Shared --overlay-scrim, NO blur (a drawer keeps the page comparable,
      // like a Sheet). vaul forwards data-state, so the fade keyframes apply —
      // the baseline overlay hard-cut without them.
      'bg-overlay-scrim fixed inset-0 z-50',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      'duration-slow ease-out-quart',
      className,
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const t = useTranslations('common');
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        // shadow-lg: a drawer is modal-family (dims the page, traps focus); the
        // baseline shipped no shadow token, so under the scrim it read flat with
        // only a 1px border. (No stray mt-sm — the element is fixed bottom-0, so
        // a top margin never rendered.)
        className={cn(
          'border-border bg-card text-foreground fixed inset-x-0 bottom-0 z-50 flex h-auto flex-col rounded-t-xl border shadow-lg',
          className,
        )}
        {...props}
      >
        {/* vaul's semantic grab handle — ships its own larger invisible hit-area
            + drag semantics; the visible bar is the muted pill. */}
        <DrawerPrimitive.Handle className="bg-muted mt-sm mx-auto h-1.5 w-12 rounded-full" />
        {/* Screen-reader dismiss — sighted users swipe down, tap the scrim, or
            press Escape; AT users get an explicit, labelled close control. */}
        <DrawerClose className="sr-only">{t('close')}</DrawerClose>
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
});
DrawerContent.displayName = 'DrawerContent';

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('gap-3xs p-lg grid text-center sm:text-left', className)} {...props} />;
}

export function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn('gap-xs p-lg mt-auto flex flex-col', className)} {...props} />;
}

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold tracking-tight', className)}
    {...props}
  />
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;
