'use client';

import * as MenubarPrimitive from '@radix-ui/react-menubar';
import { ArrowRight01Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Desktop-style horizontal menu bar (File, Edit, View…) with auto-open
 * sub-menus on hover once the first menu is opened. Almost never the
 * right primitive for a SaaS dashboard — sidebar navigation and
 * dropdown menus carry the same affordances with better mobile reach.
 * Use only for genuine document-style apps where a menu bar matches
 * user expectations (editors, IDEs, design tools).
 *
 * @useWhen building a document-style desktop top menu bar (rare in SaaS dashboards — prefer sidebar navigation + dropdown menus)
 */

export const MenubarMenu = MenubarPrimitive.Menu;
export const MenubarGroup = MenubarPrimitive.Group;
export const MenubarPortal = MenubarPrimitive.Portal;
export const MenubarSub = MenubarPrimitive.Sub;
export const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

export const Menubar = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Root
    ref={ref}
    className={cn(
      'gap-3xs border-border bg-background p-3xs flex h-10 items-center rounded-md border',
      className,
    )}
    {...props}
  />
));
Menubar.displayName = MenubarPrimitive.Root.displayName;

export const MenubarTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Trigger
    ref={ref}
    className={cn(
      'px-sm py-3xs flex cursor-default items-center rounded-sm text-sm font-medium outline-none select-none',
      'duration-fast ease-out-quart transition-colors',
      // Radix sets data-highlighted on arrow-nav across the bar; data-state=open
      // is the active-menu fill. Suppress the global focus glow on the row.
      'data-[highlighted]:bg-muted data-[state=open]:bg-muted',
      'focus:shadow-none focus-visible:shadow-none',
      className,
    )}
    {...props}
  />
));
MenubarTrigger.displayName = MenubarPrimitive.Trigger.displayName;

export const MenubarSubTrigger = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'gap-xs px-xs py-2xs flex cursor-default items-center rounded-sm text-sm outline-none select-none',
      'duration-fast ease-out-quart transition-colors pointer-coarse:min-h-11',
      'data-[highlighted]:bg-muted data-[state=open]:bg-muted',
      'focus:shadow-none focus-visible:shadow-none',
      className,
    )}
    {...props}
  >
    {children}
    <ArrowRight01Icon className="size-icon-sm text-muted-foreground ml-auto" />
  </MenubarPrimitive.SubTrigger>
));
MenubarSubTrigger.displayName = MenubarPrimitive.SubTrigger.displayName;

export const MenubarSubContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.SubContent
    ref={ref}
    className={cn(
      'border-border bg-popover p-3xs text-popover-foreground z-50 min-w-32 overflow-hidden rounded-md border shadow-md',
      // Sub-content shipped with NO animation at all — give it the full recipe.
      'origin-[var(--radix-menubar-content-transform-origin)]',
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
));
MenubarSubContent.displayName = MenubarPrimitive.SubContent.displayName;

export const MenubarContent = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Content>
>(({ className, align = 'start', alignOffset = -4, sideOffset = 8, ...props }, ref) => (
  <MenubarPrimitive.Portal>
    <MenubarPrimitive.Content
      ref={ref}
      align={align}
      alignOffset={alignOffset}
      sideOffset={sideOffset}
      className={cn(
        'border-border bg-popover p-3xs text-popover-foreground z-50 min-w-48 overflow-hidden rounded-md border shadow-md',
        // Was fade-only — complete to the full house entrance recipe.
        'origin-[var(--radix-menubar-content-transform-origin)]',
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
  </MenubarPrimitive.Portal>
));
MenubarContent.displayName = MenubarPrimitive.Content.displayName;

export const MenubarItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <MenubarPrimitive.Item
    ref={ref}
    className={cn(
      'gap-xs px-xs py-2xs relative flex cursor-default items-center rounded-sm text-sm outline-none select-none',
      'duration-fast ease-out-quart transition-colors pointer-coarse:min-h-11',
      'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
      'focus:shadow-none focus-visible:shadow-none',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-lg',
      className,
    )}
    {...props}
  />
));
MenubarItem.displayName = MenubarPrimitive.Item.displayName;

export const MenubarCheckboxItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <MenubarPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'py-2xs pl-lg pr-xs relative flex cursor-default items-center rounded-sm text-sm outline-none select-none',
      'duration-fast ease-out-quart transition-colors pointer-coarse:min-h-11',
      'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
      'focus:shadow-none focus-visible:shadow-none data-[state=checked]:font-medium',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="left-xs size-icon-sm absolute flex items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <Tick02Icon className="text-primary size-3.5" strokeWidth={2.5} />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.CheckboxItem>
));
MenubarCheckboxItem.displayName = MenubarPrimitive.CheckboxItem.displayName;

export const MenubarRadioItem = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <MenubarPrimitive.RadioItem
    ref={ref}
    className={cn(
      'py-2xs pl-lg pr-xs relative flex cursor-default items-center rounded-sm text-sm outline-none select-none',
      'duration-fast ease-out-quart transition-colors pointer-coarse:min-h-11',
      'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
      'focus:shadow-none focus-visible:shadow-none data-[state=checked]:font-medium',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="left-xs size-icon-sm absolute flex items-center justify-center">
      <MenubarPrimitive.ItemIndicator>
        <span className="bg-primary size-2 rounded-full" />
      </MenubarPrimitive.ItemIndicator>
    </span>
    {children}
  </MenubarPrimitive.RadioItem>
));
MenubarRadioItem.displayName = MenubarPrimitive.RadioItem.displayName;

export const MenubarSeparator = React.forwardRef<
  React.ElementRef<typeof MenubarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof MenubarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <MenubarPrimitive.Separator
    ref={ref}
    className={cn('-mx-3xs my-3xs bg-border h-px', className)}
    {...props}
  />
));
MenubarSeparator.displayName = MenubarPrimitive.Separator.displayName;

export function MenubarShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return (
    <span
      className={cn('text-2xs text-muted-foreground ml-auto tracking-wide', className)}
      {...props}
    />
  );
}
