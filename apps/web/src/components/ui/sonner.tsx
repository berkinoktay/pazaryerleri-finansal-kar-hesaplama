'use client';

import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from 'hugeicons-react';
import { Toaster as Sonner } from 'sonner';

import { Spinner } from '@/components/ui/spinner';
import { useIsMounted } from '@/lib/use-is-mounted';
import { useTheme } from '@/providers/theme-provider';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Global toast container — mount once at the app root. Toasts are fired
 * via the exported `toast` function from any component:
 *
 *   import { toast } from '@/components/ui/sonner';
 *   toast.success('Saved.');
 *
 * Each toast is a card with a tone icon (left) + bold title + muted
 * description, optional action / cancel buttons and a close affordance.
 * Per-tone toasts mirror Alert exactly: `toast.success()` is a tinted card
 * (`bg-success-surface` + `text-success` + a soft `border-success-border`)
 * with a green check, so a success toast and a success Alert read the same.
 * `toast.error()` maps to the **destructive** tone; the neutral `toast()` is a
 * framed `bg-card` with no icon. Custom icons / soft-square badges go per call:
 * `toast('…', { icon: <TruckIcon /> })`.
 *
 * The base `toast` class carries layout only and the per-type class carries the
 * single color pairing, so the tone always wins (two competing `bg-*`/`border-*`
 * utilities on one element are order-dependent). The toaster is mount-gated
 * (Sonner's portal carries a `theme` class that would otherwise hydration-
 * mismatch); users never see a toast on first paint anyway.
 *
 * For inline page-level messages use Alert; for app-spanning system messages
 * (maintenance, billing past-due) use the future Banner.
 *
 * @useWhen mounting the global toast container at the app root (call the exported toast() from feature code to fire a toast)
 */
export function Toaster(props: ToasterProps): React.ReactElement | null {
  const { resolvedTheme } = useTheme();
  const mounted = useIsMounted();

  if (!mounted) return null;

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="toaster group"
      position="bottom-right"
      closeButton
      icons={{
        success: <CheckmarkCircle02Icon className="size-icon-sm" />,
        error: <AlertCircleIcon className="size-icon-sm" />,
        warning: <Alert02Icon className="size-icon-sm" />,
        info: <InformationCircleIcon className="size-icon-sm" />,
        loading: <Spinner size="sm" />,
      }}
      toastOptions={{
        classNames: {
          // `default` is applied to EVERY toast (not only neutral ones), so the
          // per-type color must win deterministically — hence the `!` important
          // modifier (Sonner's own injected styles also fix the source order).
          toast:
            'group toast group-[.toaster]:gap-sm group-[.toaster]:rounded-lg group-[.toaster]:border group-[.toaster]:p-md group-[.toaster]:shadow-md',
          default:
            'group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border',
          success:
            'group-[.toaster]:bg-success-surface! group-[.toaster]:text-success! group-[.toaster]:border-success-border!',
          warning:
            'group-[.toaster]:bg-warning-surface! group-[.toaster]:text-warning! group-[.toaster]:border-warning-border!',
          error:
            'group-[.toaster]:bg-destructive-surface! group-[.toaster]:text-destructive! group-[.toaster]:border-destructive-border!',
          info: 'group-[.toaster]:bg-info-surface! group-[.toaster]:text-info! group-[.toaster]:border-info-border!',
          // Sonner colors the icon slot AND pins it to 16px — force it to
          // inherit the toast's tone (so a success toast gets a green check) and
          // size to its content (so a larger custom soft-square icon fits
          // without overflowing the slot).
          icon: 'group-[.toast]:mt-px group-[.toast]:size-auto! group-[.toast]:shrink-0 group-[.toast]:text-inherit!',
          title: 'group-[.toast]:text-sm group-[.toast]:font-semibold!',
          // Inherit the toast's tone color (never gray-on-tint), dimmed.
          description: 'group-[.toast]:text-2xs group-[.toast]:opacity-80',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md group-[.toast]:px-sm group-[.toast]:text-2xs group-[.toast]:font-medium',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-md group-[.toast]:px-sm group-[.toast]:text-2xs',
          closeButton:
            'group-[.toast]:border-border group-[.toast]:bg-card group-[.toast]:text-muted-foreground group-[.toast]:hover:text-foreground',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
