'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Searchable command palette built on cmdk — a list of typeahead-
 * filtered items grouped into sections, with optional keyboard
 * shortcuts. `CommandDialog` wraps it in a Dialog for the canonical
 * `Cmd+K` palette pattern; bare `Command` composes inside any
 * surface (Popover, Sheet, inline panel). Use for discoverable
 * many-options pickers; for short fixed lists use Select instead.
 *
 * @useWhen building a searchable command palette or large typeahead-filtered picker (use Select for short fixed-option lists)
 */

export const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  children?: React.ReactNode;
}

export function CommandDialog({ children, ...props }: CommandDialogProps): React.ReactElement {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-xs [&_[cmdk-group-heading]]:font-medium">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
    /** Override classes on the outer wrapper (icon + input shell). */
    wrapperClassName?: string;
  }
>(({ className, wrapperClassName, ...props }, ref) => (
  // Wrapper mirrors Input's wrapperVariants (md size): bordered, rounded,
  // shadow-xs, focus-within:border-ring. The previous flush border-b layout
  // let the global :focus-visible rule (globals.css → box-shadow:
  // var(--shadow-focus)) paint a 3px brand-blue glow around the inner input's
  // full bounding box — visible in DevTools as a glowing rectangle inside
  // the popover. Input's pattern (suppress shadow on the inner element,
  // indicate focus via the wrapper's border) is the design-system convention
  // and what consumers expect here too.
  <div
    className={cn(
      'gap-xs px-sm m-3xs h-10',
      'border-border bg-background text-foreground flex items-center rounded-md border shadow-xs',
      'duration-fast transition-colors',
      'hover:border-border-strong focus-within:border-ring',
      wrapperClassName,
    )}
    cmdk-input-wrapper=""
  >
    <Search01Icon className="size-icon-sm text-muted-foreground shrink-0" aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'min-w-0 flex-1 border-0 bg-transparent text-sm shadow-none ring-0 outline-none',
        'focus:outline-none focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none',
        'placeholder:text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-72 overflow-x-hidden overflow-y-auto', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-md text-muted-foreground text-center text-sm"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'p-3xs text-foreground [&_[cmdk-group-heading]]:px-xs [&_[cmdk-group-heading]]:py-3xs [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

export const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-3xs bg-border h-px', className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "gap-xs px-xs py-3xs aria-selected:bg-muted aria-selected:text-foreground relative flex cursor-default items-center rounded-sm text-sm outline-none select-none data-[disabled='true']:pointer-events-none data-[disabled='true']:opacity-50",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export function CommandShortcut({
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
