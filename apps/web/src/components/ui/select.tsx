'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Single-choice dropdown picker. The trigger owns its own `loading`,
 * `invalid`, `leadingIcon`, and `onClear` props. The clear affordance is a
 * `<span role="button">` rather than a real button — the trigger itself is
 * already a `<button>` and HTML forbids nested buttons (browsers silently
 * re-parent them, breaking hydration). For a searchable / typeahead picker
 * use Combobox instead (Phase 1, not yet built).
 *
 * @useWhen rendering a single-choice picker with a fixed list of options and no need for typeahead search
 */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const selectTriggerVariants = cva(
  [
    'flex w-full items-center gap-xs border border-border bg-input text-foreground shadow-xs transition-colors duration-fast',
    'placeholder:text-muted-foreground',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
    '[&>span]:line-clamp-1',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 px-sm py-3xs text-xs',
        md: 'h-10 px-sm py-xs text-sm',
        lg: 'h-11 px-md py-xs text-base',
      },
      radius: {
        none: 'rounded-none',
        xs: 'rounded-xs',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        '2xl': 'rounded-2xl',
        full: 'rounded-full',
      },
    },
    defaultVariants: { size: 'md', radius: 'md' },
  },
);

export interface SelectTriggerProps
  extends
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {
  /** Decorative icon on the left of the trigger. Auto-sized to `size-icon-sm`. */
  leadingIcon?: React.ReactNode;
  /** Shows a spinner inside the trigger; sets `aria-busy="true"`. Does not disable the trigger. */
  loading?: boolean;
  /** Translated aria-label for the loading spinner. Defaults to `'Loading'`. */
  loadingLabel?: string;
  /** When provided, renders a clear button before the chevron. Callback should reset the Select's value. */
  onClear?: () => void;
  /** Translated aria-label for the clear button. Defaults to `'Clear'`. */
  clearLabel?: string;
  /** Convenience boolean for `aria-invalid="true"` on the trigger. Triggers destructive border. */
  invalid?: boolean;
}

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>((props, ref) => {
  const {
    className,
    size,
    radius,
    children,
    leadingIcon,
    loading,
    loadingLabel = 'Loading',
    onClear,
    clearLabel = 'Clear',
    invalid,
    ...rest
  } = props;

  // Radix renders SelectTrigger as a <button>, and HTML forbids nested buttons
  // (browsers silently re-parent them, causing a hydration mismatch). So the
  // clear affordance is a <span role="button"> with keyboard + pointer handlers
  // — accessible as a button, but not a DOM button.
  const handleClear = (event: React.SyntheticEvent<HTMLSpanElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    onClear?.();
  };

  const handleClearKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onClear?.();
    }
  };

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid ?? undefined}
      aria-busy={loading ?? undefined}
      className={cn(selectTriggerVariants({ size, radius, className }))}
      {...rest}
    >
      {leadingIcon !== undefined ? (
        <span className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center">
          {leadingIcon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-center truncate text-start">{children}</span>
      <div className="gap-xs flex shrink-0 items-center">
        {loading === true ? (
          <Spinner label={loadingLabel} className="text-muted-foreground" />
        ) : null}
        {onClear !== undefined ? (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={handleClearKeyDown}
            aria-label={clearLabel}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center',
              'text-muted-foreground hover:text-foreground rounded-xs',
              'duration-fast transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              'p-2xs pointer-coarse:p-sm',
              '[&_svg]:size-icon-sm',
            )}
          >
            <Cancel01Icon />
          </span>
        ) : null}
        <SelectPrimitive.Icon asChild>
          <ArrowDown01Icon className="size-icon-sm opacity-50" />
        </SelectPrimitive.Icon>
      </div>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export { selectTriggerVariants };

export const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('py-3xs flex cursor-default items-center justify-center', className)}
    {...props}
  >
    <ArrowUp01Icon className="size-icon-sm" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('py-3xs flex cursor-default items-center justify-center', className)}
    {...props}
  >
    <ArrowDown01Icon className="size-icon-sm" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'border-border bg-popover text-popover-foreground relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-3xs',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      'px-xs py-3xs text-2xs text-muted-foreground font-medium tracking-wide uppercase',
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'py-3xs pl-lg pr-xs relative flex w-full cursor-default items-center rounded-sm text-sm outline-none select-none',
      'focus:bg-muted focus:text-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="left-xs absolute flex size-3 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Tick02Icon className="size-3" strokeWidth={3} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-3xs my-3xs bg-border h-px', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
