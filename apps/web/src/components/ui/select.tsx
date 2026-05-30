'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Single-choice dropdown picker. The trigger owns its own `loading`,
 * `invalid`, `valid`, `leadingIcon`, and `onClear` props and shares the
 * Button interaction language (cursor-pointer, press-scale, touch floor,
 * focus glow, error shake). The chevron rotates 180° while the panel is
 * open. The clear affordance is a `<span role="button">` rather than a real
 * button — the trigger itself is already a `<button>` and HTML forbids
 * nested buttons (browsers silently re-parent them, breaking hydration).
 *
 * `SelectItem` accepts `leadingIcon` (icon/logo/status dot left of the
 * label) and `description` (a muted secondary line) — both render OUTSIDE
 * `SelectPrimitive.ItemText` so only the primary label is spoken / used for
 * typeahead. For a searchable / typeahead picker use Combobox instead
 * (Phase 1, not yet built).
 *
 * @useWhen rendering a single-choice picker with a fixed list of options and no need for typeahead search
 */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const selectTriggerVariants = cva(
  [
    // `group` so the chevron can read the trigger's data-[state=open] to rotate.
    'group flex w-full cursor-pointer items-center gap-xs border border-border-input bg-input text-foreground shadow-xs transition duration-fast ease-out-quart',
    'pointer-coarse:min-h-11',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:shadow-focus focus-visible:outline-none',
    // No active:scale press here — a Select reads as an input FIELD, not an
    // action button; the button-press shrink feels wrong on an input-styled
    // "open a panel" trigger. (Action buttons keep their press-scale.)
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:shadow-none aria-invalid:animate-field-shake',
    'data-[valid=true]:border-success data-[valid=true]:focus-visible:border-success data-[valid=true]:focus-visible:shadow-none',
    // Radix sets `data-placeholder` on the trigger button itself while the
    // placeholder is shown (not on a descendant span, and `:placeholder` does
    // not apply to a <button>) — so mute the trigger; it clears to foreground
    // automatically once a value is selected.
    'data-[placeholder]:text-muted-foreground',
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
  /** Marks the selection as validated-OK — success-tinted border. Mutually exclusive with `invalid`. */
  valid?: boolean;
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
    valid,
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
      aria-busy={loading === true ? true : undefined}
      data-valid={valid === true ? 'true' : undefined}
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
          <ArrowDown01Icon className="size-icon-sm duration-fast ease-out-quart opacity-50 transition-transform group-data-[state=open]:rotate-180" />
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
        // Viewport-aware height cap (Radix exposes the available height as a CSS
        // var) so the panel never overflows a short viewport on tablet/mobile.
        'border-border bg-popover text-popover-foreground relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-32 overflow-hidden rounded-md border shadow-md',
        // Combined zoom + side-anchored slide, matching Popover / DropdownMenu —
        // gives the panel spatial continuity from its trigger instead of a flat fade.
        'duration-base ease-out-quart',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
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

export interface SelectItemProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Item
> {
  /** Decorative icon / logo / status dot left of the label. Auto-sized to `size-icon-sm`. */
  leadingIcon?: React.ReactNode;
  /** Muted secondary line below the label. Kept outside `ItemText` so only the label is spoken / used for typeahead. */
  description?: React.ReactNode;
}

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  SelectItemProps
>(({ className, children, leadingIcon, description, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'py-2xs pl-lg pr-sm gap-xs relative flex w-full cursor-default items-center rounded-sm text-sm outline-none select-none',
      'duration-fast ease-out-quart transition-colors',
      // Clean full-row highlight via Radix data-highlighted (pointer hover +
      // keyboard). Suppress the global :focus-visible brand glow — a ring
      // around a list row reads as a heavy box; the fill IS the focus
      // affordance here. Selected row reads slightly stronger (medium weight).
      'data-[highlighted]:bg-muted data-[highlighted]:text-foreground',
      'focus:shadow-none focus-visible:shadow-none',
      'data-[state=checked]:font-medium',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="left-2xs size-icon-sm absolute inset-y-0 my-auto flex items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Tick02Icon className="text-primary size-3.5" strokeWidth={2.5} />
      </SelectPrimitive.ItemIndicator>
    </span>
    {leadingIcon !== undefined ? (
      <span className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center">
        {leadingIcon}
      </span>
    ) : null}
    <span className="flex min-w-0 flex-col">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {description !== undefined ? (
        <span className="text-2xs text-muted-foreground truncate">{description}</span>
      ) : null}
    </span>
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
