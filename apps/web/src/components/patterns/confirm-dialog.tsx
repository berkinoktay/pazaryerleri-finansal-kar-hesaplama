'use client';

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Standard confirmation prompt for destructive (and occasionally
 * non-destructive) actions. Wraps `AlertDialog` with the canonical
 * footer shape — Cancel on the left, primary action on the right —
 * so every "are you sure" prompt across the app reads the same way.
 *
 * Two modes for the open state:
 * - Controlled: pass `open` + `onOpenChange` (caller owns the state).
 * - Trigger-based: pass a `trigger` element; the dialog manages its
 *   own visibility via `AlertDialogTrigger`.
 *
 * `onConfirm` is async-friendly. While the promise is pending the
 * confirm button shows a spinner and both buttons disable so the
 * user can't double-fire or escape mid-flight. Reject from inside
 * `onConfirm` to keep the dialog open (caller surfaces the error
 * via toast / inline copy).
 *
 * For destructive flows the `tone="destructive"` default styles the
 * confirm button with the destructive button variant; pass
 * `tone="default"` for non-destructive confirms (e.g. "Send invite?")
 * — those are rare; most confirmations exist precisely because the
 * action is hard to undo.
 *
 * @useWhen confirming a destructive or hard-to-undo action with a yes/no prompt (use Dialog for non-destructive multi-field inputs, Sonner for one-shot undo toasts)
 */

export interface ConfirmDialogProps {
  /** Controlled open state. Omit if using `trigger`. */
  open?: boolean;
  /** Fires when Radix wants to flip the open state. Omit if using `trigger`. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional trigger element. When provided, the dialog manages its
   * own visibility via Radix `AlertDialogTrigger` and `open` /
   * `onOpenChange` are unnecessary. When omitted the dialog runs in
   * controlled mode and the caller is responsible for opening it.
   */
  trigger?: React.ReactNode;
  /** Bold dialog title — what action is being confirmed. */
  title: React.ReactNode;
  /**
   * Body copy explaining the consequence. Should mention that the
   * action is irreversible (or describe what happens) so users have
   * the information needed to decide.
   */
  description?: React.ReactNode;
  /** Optional richer body slot rendered between description and footer. */
  children?: React.ReactNode;
  /**
   * Tone of the confirm button. Defaults to `'destructive'` since
   * this prompt exists almost exclusively for irreversible actions.
   */
  tone?: 'destructive' | 'default';
  /** Localized confirm CTA label (e.g. "Mağazayı sil"). */
  confirmLabel: string;
  /** Localized cancel CTA label. Defaults to `'İptal'`. */
  cancelLabel?: string;
  /**
   * Confirmation handler. May return a promise — the dialog awaits
   * it, disables both buttons, and shows a spinner on the confirm
   * button while pending. Reject to keep the dialog open.
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Force the loading state from outside. Useful when the caller's
   * mutation state lives in React Query and you want the dialog to
   * reflect it without owning the promise inside `onConfirm`.
   */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  tone = 'destructive',
  confirmLabel,
  cancelLabel = 'İptal',
  onConfirm,
  loading = false,
}: ConfirmDialogProps): React.ReactElement {
  const [isPending, setIsPending] = React.useState(false);
  const isBusy = loading || isPending;

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    // Stop Radix from auto-closing the dialog so the caller can keep
    // it open while the async work runs (and re-throw to keep it open
    // on failure).
    event.preventDefault();
    if (isBusy) return;
    try {
      setIsPending(true);
      await onConfirm();
      onOpenChange?.(false);
    } catch {
      // Caller surfaces error UI itself (toast / inline copy). Dialog
      // stays open so the user can retry or cancel.
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description !== undefined ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              void handleConfirm(event);
            }}
            disabled={isBusy}
            className={cn(tone === 'default' && buttonVariants({ variant: 'default' }), 'gap-xs')}
          >
            {isBusy ? <Spinner /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
