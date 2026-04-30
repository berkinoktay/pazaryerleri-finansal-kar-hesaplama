'use client';

import { Toaster as Sonner } from 'sonner';

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
 * The toaster is mount-gated (returns null on the server and during the
 * first client render) because Sonner's portal carries a `theme` class
 * that would otherwise produce a hydration mismatch — users never see a
 * toast on first paint anyway, so the gate is invisible.
 *
 * For inline page-level messages use Alert; for app-spanning system
 * messages (maintenance, billing past-due) use the future Banner.
 *
 * @useWhen mounting the global toast container at the app root (call the exported toast() from feature code to fire a toast)
 */
export function Toaster(props: ToasterProps): React.ReactElement | null {
  const { resolvedTheme } = useTheme();
  const mounted = useIsMounted();

  // `resolvedTheme` is undefined on the server and during the first client
  // render. Sonner's root carries a theme class on its portal wrapper — if
  // we rendered during SSR we would bake in `theme="light"` and then swap
  // to the user's actual theme at hydration, producing a mismatch. Waiting
  // for mount keeps the hydrated tree empty for the toaster (users never
  // see a toast on first paint anyway).
  if (!mounted) return null;

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-md group-[.toaster]:rounded-md',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-sm',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-sm',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
