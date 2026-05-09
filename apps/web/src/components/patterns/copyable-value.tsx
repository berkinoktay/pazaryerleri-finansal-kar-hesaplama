'use client';

import { Copy01Icon, Tick02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface CopyableValueProps {
  /** The string written to the clipboard on click. */
  value: string;
  /**
   * Human label for the value's category (e.g. "Stok Kodu", "Barkod").
   * Used to compose the aria-label and the post-copy confirmation —
   * `"{label} kopyalandı"`. The user sees this only via screen reader,
   * but it's required so every copy button announces what it copied.
   */
  label: string;
  /** The visible content. The whole wrapper is the click target. */
  children: React.ReactNode;
  className?: string;
}

const CONFIRM_DURATION_MS = 1500;

/**
 * Wraps short identifiers (barcodes, stock codes, model codes, request
 * IDs, support tokens, …) so the seller can copy them in one click —
 * the entire visible value is the click target, not just the icon.
 *
 * Visual rules:
 *   - The whole wrapper is a `<button>` so clicking the value text
 *     itself copies (large hit target, cursor-pointer, keyboard-friendly).
 *   - A trailing copy icon appears on row hover / focus / touch as a
 *     subtle affordance hint; on a successful copy it swaps to a check
 *     icon for ~1.5 s. No toast — the inline swap + the value's
 *     enduring presence is feedback enough; toasts on a high-frequency
 *     action become noise.
 *   - `data-row-action` opts the click out of `DataTable`'s row-click
 *     activation. Wrap any cell content with this without worrying
 *     about row navigation.
 *
 * @useWhen surfacing a short identifier the user is likely to paste
 *   into another system (Trendyol seller panel, marketplace search,
 *   inventory tooling, support tickets).
 */
export function CopyableValue({
  value,
  label,
  children,
  className,
}: CopyableValueProps): React.ReactElement {
  const t = useTranslations('common.copy');
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), CONFIRM_DURATION_MS);
    } catch {
      // Clipboard API requires a secure context; in the rare insecure
      // case we fail silently — the value stays selectable so the user
      // can copy manually.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t('copied', { label }) : t('copy', { label })}
      data-row-action
      className={cn(
        // Inline-flex so the button flows alongside surrounding text in a
        // sentence ("Model · {value}") without forcing a line break.
        'group/copy gap-3xs inline-flex items-center',
        'cursor-pointer rounded-sm',
        // Negative margins + matching padding give the hover surface
        // some breathing room WITHOUT shifting the layout when idle —
        // the hovered chip "grows" into existing whitespace.
        '-mx-3xs px-3xs -my-3xs py-3xs',
        'duration-fast transition-colors',
        'hover:bg-muted',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          'text-muted-foreground group-hover/copy:text-foreground',
          'duration-fast transition',
          // Visible on row hover / button hover / focus / touch so the
          // affordance is always discoverable when the user reaches for
          // it. Stays hidden when nobody is looking — keeps the table calm.
          'opacity-0 group-hover/copy:opacity-100 group-hover/row:opacity-100',
          'focus-visible:opacity-100 pointer-coarse:opacity-100',
          copied && 'text-success opacity-100',
        )}
      >
        {copied ? <Tick02Icon className="size-icon-xs" /> : <Copy01Icon className="size-icon-xs" />}
      </span>
    </button>
  );
}
