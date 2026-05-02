'use client';

import { Pen01Icon } from 'hugeicons-react';
import * as React from 'react';

import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Edit-in-place: click a value to turn it into an input, commit on
 * Enter / blur, cancel on Escape. Preserves the surrounding page
 * context — preferred over a modal whenever the user is editing a
 * single value (cost, store name, commission rate) and needs to keep
 * the rest of the row visible while typing.
 *
 * Generic value/onCommit API:
 * - `value`: the current string (consumers convert from Decimal /
 *   Date / etc. before passing in)
 * - `onCommit(next)`: fires once on Enter or blur (when
 *   `commitOnBlur=true`) with the draft string
 * - `renderDisplay(value)`: custom display node — typically a
 *   `<Currency>`, `<TrendDelta>`, or formatted span; defaults to the
 *   raw string
 * - `renderEdit(props)`: optional custom editor — defaults to the
 *   shared `Input` primitive (use it to drop in `MoneyInput` /
 *   `PercentageInput` for typed editing)
 *
 * Keyboard contract
 * - Enter: commit + return to display
 * - Escape: discard draft + return to display
 * - Tab away (blur): commits when `commitOnBlur=true` (default), else
 *   discards
 *
 * Accessibility
 * - Display surface is a `<button type="button">` so keyboard users
 *   tab into it and Enter switches to edit mode
 * - Edit mode auto-focuses + selects-all so the user can immediately
 *   type a replacement value
 *
 * @useWhen letting the user edit a single value (cost, store name, commission rate) without leaving the row — preferred over a modal for one-off changes
 */

export interface InlineEditEditorProps {
  /** Current draft string. Bound to the editor's `value`. */
  value: string;
  /** Commits the draft on Enter or blur. */
  onChange: (next: string) => void;
  /** Reference to the underlying input so the wrapper can focus + select-all on enter-edit. */
  ref: React.Ref<HTMLInputElement>;
  /** Wired keyboard handler — calls onCommit on Enter, onCancel on Escape. */
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Wired blur handler — commits when `commitOnBlur=true`, cancels otherwise. */
  onBlur: () => void;
}

export interface InlineEditProps {
  /** Current committed value (string). */
  value: string;
  /** Fires once when the user commits a new value via Enter / blur. */
  onCommit: (next: string) => void;
  /** When the user enters edit mode without a value, show this hint. */
  placeholder?: string;
  /**
   * Render the display surface. Defaults to plain text (or placeholder
   * when value is empty). Use to slot in `<Currency>`, formatted
   * spans, etc.
   */
  renderDisplay?: (value: string) => React.ReactNode;
  /**
   * Render the editor. Defaults to a basic `Input`. Use to drop in
   * `MoneyInput` / `PercentageInput` / etc. — the editor must wire
   * `value`, `onChange`, `ref`, `onKeyDown`, and `onBlur`.
   */
  renderEdit?: (props: InlineEditEditorProps) => React.ReactNode;
  /** When true (default), tabbing away commits the draft. When false, blur discards. */
  commitOnBlur?: boolean;
  /** Disables the click-to-edit affordance entirely. */
  disabled?: boolean;
  /** Translated accessible label (e.g. `t('orders.costEditAria')`). */
  ariaLabel?: string;
  /** Forwarded to the display button + edit input wrapper. */
  className?: string;
  /** Extra props forwarded to the default Input editor (size, invalid, etc.). Ignored when `renderEdit` is provided. */
  inputProps?: Omit<InputProps, 'value' | 'onChange' | 'onKeyDown' | 'onBlur'>;
}

export function InlineEdit({
  value,
  onCommit,
  placeholder,
  renderDisplay,
  renderEdit,
  commitOnBlur = true,
  disabled = false,
  ariaLabel,
  className,
  inputProps,
}: InlineEditProps): React.ReactElement {
  const [isEditing, setIsEditing] = React.useState(false);
  // The draft is captured fresh from `value` each time the user enters
  // edit mode (see `enterEdit` below). Outside of editing we render
  // `value` directly — there's no need to mirror it into state, which
  // would risk clobbering an in-progress draft on a parent re-render.
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const enterEdit = (): void => {
    if (disabled) return;
    setDraft(value);
    setIsEditing(true);
    // Defer focus to next tick so the input has mounted before we focus + select.
    queueMicrotask(() => {
      const node = inputRef.current;
      if (node !== null) {
        node.focus();
        node.select();
      }
    });
  };

  const commit = (): void => {
    setIsEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const cancel = (): void => {
    setIsEditing(false);
    setDraft(value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  const handleBlur = (): void => {
    if (commitOnBlur) commit();
    else cancel();
  };

  if (!isEditing) {
    const displayContent =
      renderDisplay !== undefined ? (
        renderDisplay(value)
      ) : value !== '' ? (
        <span className="text-foreground">{value}</span>
      ) : (
        <span className="text-muted-foreground">{placeholder ?? ''}</span>
      );

    return (
      <button
        type="button"
        disabled={disabled}
        onClick={enterEdit}
        aria-label={ariaLabel}
        className={cn(
          'group gap-xs px-xs py-3xs duration-fast inline-flex items-center rounded-sm text-left transition-colors',
          'hover:bg-muted',
          'focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {displayContent}
        <Pen01Icon
          aria-hidden
          className="size-icon-xs text-muted-foreground duration-fast opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  }

  if (renderEdit !== undefined) {
    return (
      <>
        {renderEdit({
          value: draft,
          onChange: setDraft,
          ref: inputRef,
          onKeyDown: handleKeyDown,
          onBlur: handleBlur,
        })}
      </>
    );
  }

  return (
    <Input
      ref={inputRef}
      {...inputProps}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={cn(className, inputProps?.className)}
    />
  );
}
