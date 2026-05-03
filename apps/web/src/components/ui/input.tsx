'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Cancel01Icon, ViewIcon, ViewOffIcon } from 'hugeicons-react';
import * as React from 'react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Single-line text input. Owns its own state for adornments (`leadingIcon`,
 * `trailingIcon`, free-form `leading` / `trailing` slots), `loading`,
 * `invalid`, `onClear`, and password `reveal` toggle — consumers don't
 * re-implement these UX patterns. Sizes `sm | md | lg` align with Button
 * and SelectTrigger so form rows stay rhythmically consistent.
 *
 * @useWhen rendering a single-line text input that may need a leading or trailing slot, clear button, password reveal toggle, or async loading indicator
 */

const inputVariants = cva(
  [
    'flex w-full border border-border bg-input text-foreground shadow-xs transition-colors duration-fast',
    'placeholder:text-muted-foreground',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'file:border-0 file:bg-transparent file:text-sm file:font-medium',
    'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
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

const wrapperVariants = cva(
  [
    'inline-flex w-full items-center gap-xs border border-border bg-input text-foreground shadow-xs transition-colors duration-fast',
    'hover:border-border-strong',
    'focus-within:border-ring',
    'data-[invalid=true]:border-destructive data-[invalid=true]:focus-within:border-destructive',
    'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 px-sm text-xs',
        md: 'h-10 px-sm text-sm',
        lg: 'h-11 px-md text-base',
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

const innerInputClass = cn(
  'min-w-0 flex-1 border-0 bg-transparent text-inherit outline-none shadow-none ring-0',
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0',
  'placeholder:text-muted-foreground',
  'disabled:cursor-not-allowed',
  'file:border-0 file:bg-transparent file:text-sm file:font-medium',
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Decorative icon on the left. Auto-sized to `size-icon-sm` (16px). */
  leadingIcon?: React.ReactNode;
  /** Decorative icon on the right. */
  trailingIcon?: React.ReactNode;
  /** Free-form left slot (e.g. prefix text `TR+`, currency symbol `₺`). */
  leading?: React.ReactNode;
  /** Free-form right slot (e.g. unit `kg`, kbd hint `⌘K`). */
  trailing?: React.ReactNode;
  /** When provided, renders a clear button on the right whenever the input has a value. */
  onClear?: () => void;
  /** Translated aria-label for the clear button. Defaults to `'Clear'`. */
  clearLabel?: string;
  /** Shows a spinner on the right and sets `aria-busy="true"`. Does NOT disable the input. */
  loading?: boolean;
  /** Translated aria-label for the loading spinner. Defaults to `'Loading'`. */
  loadingLabel?: string;
  /** Convenience boolean for `aria-invalid="true"`. Triggers destructive border. */
  invalid?: boolean;
  /**
   * Adds a show/hide toggle for password-masked fields. Only active when
   * `type="password"` — the Input owns the visibility state internally
   * and swaps to `type="text"` while the toggle is engaged. Both labels
   * are required (a11y must not be optional; keeps copy outside of the
   * primitive so the consumer owns the i18n).
   *
   * Mutually exclusive with a custom `trailing` slot: when `reveal` is
   * set, any caller-provided `trailing` is ignored in favour of the
   * generated toggle.
   */
  reveal?: { show: string; hide: string };
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>((props, forwardedRef) => {
  const {
    className,
    type,
    size,
    radius,
    leadingIcon,
    trailingIcon,
    leading,
    trailing,
    onClear,
    clearLabel = 'Clear',
    loading,
    loadingLabel = 'Loading',
    invalid,
    reveal,
    value,
    defaultValue,
    onChange,
    disabled,
    readOnly,
    ...rest
  } = props;

  const [revealed, setRevealed] = React.useState(false);
  const revealActive = reveal !== undefined && type === 'password';
  const effectiveType = revealActive && revealed ? 'text' : type;

  // When reveal is active, the primitive owns the trailing slot and
  // ignores a caller-supplied trailing. Documented on the prop above.
  const revealSlot = revealActive ? (
    <button
      type="button"
      aria-label={revealed ? reveal.hide : reveal.show}
      aria-pressed={revealed}
      onClick={() => setRevealed((prev) => !prev)}
      className={cn(
        'text-muted-foreground hover:text-foreground p-3xs rounded-xs',
        'duration-fast transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        '[&_svg]:size-icon-sm cursor-pointer',
      )}
    >
      {revealed ? <ViewOffIcon /> : <ViewIcon />}
    </button>
  ) : null;

  const effectiveTrailing = revealSlot ?? trailing;
  const hasLeading = leadingIcon !== undefined || leading !== undefined;
  const hasTrailing = trailingIcon !== undefined || effectiveTrailing !== undefined;
  const needsWrapper = hasLeading || hasTrailing || onClear !== undefined || loading === true;

  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState<string>(
    defaultValue !== undefined ? String(defaultValue) : '',
  );
  const currentValue = isControlled ? String(value) : internalValue;
  const hasValue = currentValue.length > 0;

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
    forwardedRef,
    () => inputRef.current,
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (!isControlled) setInternalValue(event.target.value);
    onChange?.(event);
  };

  const handleClear = (): void => {
    const node = inputRef.current;
    if (node) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(node, '');
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (!isControlled) setInternalValue('');
    onClear?.();
    inputRef.current?.focus();
  };

  const showClearButton =
    onClear !== undefined && hasValue && disabled !== true && readOnly !== true;

  if (!needsWrapper) {
    return (
      <input
        ref={inputRef}
        type={effectiveType}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid ?? undefined}
        aria-busy={loading ?? undefined}
        className={cn(inputVariants({ size, radius, className }))}
        {...rest}
      />
    );
  }

  const handleWrapperPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Delegate clicks on the wrapper (padding, icon slots) to the input so it receives focus
    // and the caret lands at the end. Skip when the pointer hit an interactive child — buttons
    // handle their own click, and re-focusing would fight the browser's default selection.
    if (event.target !== event.currentTarget) {
      const interactive = (event.target as HTMLElement).closest(
        'button, input, textarea, select, a, [role="button"]',
      );
      if (interactive !== null) return;
    }
    event.preventDefault();
    inputRef.current?.focus();
  };

  return (
    <div
      data-invalid={invalid ? 'true' : undefined}
      onPointerDown={handleWrapperPointerDown}
      className={cn(wrapperVariants({ size, radius }), className)}
    >
      {hasLeading ? (
        <span className="text-muted-foreground [&_svg]:size-icon-sm flex shrink-0 items-center">
          {leadingIcon ?? leading}
        </span>
      ) : null}
      <input
        ref={inputRef}
        type={effectiveType}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid ?? undefined}
        aria-busy={loading ?? undefined}
        className={innerInputClass}
        {...rest}
      />
      {hasTrailing || showClearButton || loading ? (
        <div className="gap-xs flex shrink-0 items-center">
          {loading ? <Spinner label={loadingLabel} className="text-muted-foreground" /> : null}
          {!loading && trailingIcon !== undefined ? (
            <span className="text-muted-foreground [&_svg]:size-icon-sm pointer-events-none flex items-center">
              {trailingIcon}
            </span>
          ) : null}
          {!loading && effectiveTrailing !== undefined ? (
            <span className="flex items-center">{effectiveTrailing}</span>
          ) : null}
          {showClearButton ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label={clearLabel}
              className={cn(
                'inline-flex shrink-0 cursor-pointer items-center justify-center',
                'text-muted-foreground hover:text-foreground rounded-xs',
                'duration-fast transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                'p-2xs pointer-coarse:p-sm',
                '-mr-2xs pointer-coarse:-mr-sm',
                '[&_svg]:size-icon-sm',
              )}
            >
              <Cancel01Icon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
Input.displayName = 'Input';

export { inputVariants };
