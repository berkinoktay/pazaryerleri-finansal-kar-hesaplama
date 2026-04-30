'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Multi-line text input with optional character counter (`showCount` /
 * `maxLength`) and content-driven height growth (`autoResize` + `maxRows`).
 * The auto-resize uses a hidden grid mirror so height is layout-driven —
 * never animated — which keeps caret position stable as the field grows.
 *
 * @useWhen rendering a multi-line text input that may need a character counter or autoresize behavior
 */

const textareaVariants = cva(
  [
    'flex w-full border border-border bg-background text-foreground shadow-xs transition-colors duration-fast',
    'placeholder:text-muted-foreground',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-destructive',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'min-h-16 px-sm py-xs text-xs',
        md: 'min-h-20 px-sm py-xs text-sm',
        lg: 'min-h-24 px-md py-sm text-base',
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

const wrapperVariants = cva(
  [
    'flex w-full flex-col border border-border bg-background text-foreground shadow-xs transition-colors duration-fast',
    'hover:border-border-strong',
    'focus-within:border-ring',
    'data-[invalid=true]:border-destructive data-[invalid=true]:focus-within:border-destructive',
    'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'min-h-16 px-sm py-xs text-xs',
        md: 'min-h-20 px-sm py-xs text-sm',
        lg: 'min-h-24 px-md py-sm text-base',
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

const innerTextareaClass = cn(
  'w-full resize-none border-0 bg-transparent text-inherit outline-none shadow-none ring-0',
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0',
  'placeholder:text-muted-foreground',
  'disabled:cursor-not-allowed',
);

export interface TextareaProps
  extends
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {
  /** Show a character counter in the bottom-right. Forced on when `maxLength` is set. */
  showCount?: boolean;
  /** Grow the textarea with content via content-grid mirror (no height animation). */
  autoResize?: boolean;
  /** With `autoResize`, cap expansion at this many text rows. Below the cap, scrolls internally. */
  maxRows?: number;
  /** Convenience boolean for `aria-invalid="true"`. Triggers destructive border token. */
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (props, forwardedRef) => {
    const {
      className,
      size,
      radius,
      showCount,
      autoResize,
      maxRows,
      invalid,
      maxLength,
      value,
      defaultValue,
      onChange,
      ...rest
    } = props;

    const wantsCounter = showCount === true || maxLength !== undefined;
    const needsWrapper = wantsCounter || autoResize === true;

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState<string>(
      defaultValue !== undefined ? String(defaultValue) : '',
    );
    const currentValue = isControlled ? String(value) : internalValue;

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
      if (!isControlled) setInternalValue(event.target.value);
      onChange?.(event);
    };

    // runtime-dynamic: maxRows-driven cap. Prop value × approximate em line-height.
    const maxHeightStyle: React.CSSProperties | undefined =
      autoResize === true && maxRows !== undefined
        ? { maxHeight: `${maxRows * 1.6}em` }
        : undefined;

    const textareaEl = (
      <textarea
        ref={forwardedRef}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        maxLength={maxLength}
        aria-invalid={invalid ?? undefined}
        className={
          needsWrapper ? innerTextareaClass : cn(textareaVariants({ size, radius, className }))
        }
        style={maxHeightStyle}
        {...rest}
      />
    );

    if (!needsWrapper) {
      return textareaEl;
    }

    const handleWrapperPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.target !== event.currentTarget) {
        const interactive = (event.target as HTMLElement).closest(
          'textarea, button, input, select, a, [role="button"]',
        );
        if (interactive !== null) return;
      }
      event.preventDefault();
      event.currentTarget.querySelector('textarea')?.focus();
    };

    return (
      <div
        data-invalid={invalid ? 'true' : undefined}
        onPointerDown={handleWrapperPointerDown}
        className={cn(wrapperVariants({ size, radius }), className)}
      >
        {autoResize === true ? (
          <div className="grid gap-0">
            <div
              aria-hidden="true"
              className="pointer-events-none invisible col-start-1 row-start-1 overflow-hidden break-words whitespace-pre-wrap"
              style={maxHeightStyle}
            >
              {currentValue}
              {/* newline keeps grid cell tall enough for empty trailing rows */}
              {'\n'}
            </div>
            <div className="col-start-1 row-start-1">{textareaEl}</div>
          </div>
        ) : (
          textareaEl
        )}
        {wantsCounter ? (
          <div
            aria-live="polite"
            className="text-2xs text-muted-foreground pt-xs flex justify-end tabular-nums"
          >
            {currentValue.length}
            {maxLength !== undefined ? `/${maxLength}` : null}
          </div>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';

export { textareaVariants };
