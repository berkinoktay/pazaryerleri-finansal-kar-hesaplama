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
 * DESIGN — surface-first, tone-as-accent (mirrors Alert). EVERY toast is a
 * clean `bg-card` card (hairline border + floating `shadow-lg`), NOT a
 * full-bleed tinted slab. The semantic color is concentrated into the leading
 * icon slot, styled into a soft tone MEDALLION (`bg-<tone>-surface` +
 * `text-<tone>`) — the same anatomy as the Alert medallion, so a success toast
 * and a success Alert read the same. Title is `text-foreground` (bold),
 * description is calm `text-muted-foreground`; the medallion + elevation carry
 * the signal, not a wall of color.
 *
 *   toast.success() → green medallion · toast.error() → destructive medallion
 *   toast.warning() → amber · toast.info() → blue · toast.loading() → spinner
 *   toast() (neutral) → clean card, no medallion unless a custom `icon` is
 *   passed (`toast('…', { icon: <TruckIcon /> })`), which then renders in a
 *   neutral chip.
 *
 * The per-type color lives ONLY on the `[data-icon]` medallion (via the
 * per-type classNames keys, `!`-forced past Sonner's own icon styles); the
 * base `toast`/`default` keys carry the shared card surface + layout. The
 * toaster is mount-gated (Sonner's portal carries a `theme` class that would
 * otherwise hydration-mismatch); users never see a toast on first paint anyway.
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
      position="top-right"
      // Desktop has no top chrome over the content's top-right, so the default
      // 24px offset is fine; on mobile the `md:hidden` app-shell header is 48px
      // (`--space-2xl`), so push toasts below it there to keep the bell / user
      // menu reachable.
      mobileOffset={{ top: 'calc(var(--space-2xl) + var(--space-sm))' }}
      closeButton
      icons={{
        success: <CheckmarkCircle02Icon />,
        error: <AlertCircleIcon />,
        warning: <Alert02Icon />,
        info: <InformationCircleIcon />,
        loading: <Spinner size="md" />,
      }}
      toastOptions={{
        classNames: {
          // CASCADE NOTE (load-bearing): Tailwind v4 emits every utility into
          // `@layer utilities`, but Sonner v2.0.7 injects its base CSS UNLAYERED.
          // Per the cascade, a normal UNLAYERED declaration beats ANY normal
          // layered one regardless of specificity — so a non-important utility
          // here silently loses to Sonner's defaults (surface color, radius,
          // shadow, padding, `gap: 6px`, button + close-button styling). Every
          // utility that must override Sonner therefore carries `!` (author-
          // important, the one thing that outranks an unlayered normal rule).
          // `toast` = layout, `default` = shared card surface (applied to EVERY
          // toast); the per-type keys paint ONLY the medallion.
          toast:
            'group toast group-[.toaster]:gap-sm! group-[.toaster]:rounded-lg! group-[.toaster]:border! group-[.toaster]:p-md! group-[.toaster]:shadow-lg!',
          default:
            'group-[.toaster]:bg-card! group-[.toaster]:text-foreground! group-[.toaster]:border-border!',
          // Per-type: color ONLY the medallion (`[data-icon]`). Important, and a
          // touch higher specificity than the neutral default on the `icon` key,
          // so the tone wins for typed toasts; neutral toasts keep the muted chip.
          success: '[&_[data-icon]]:bg-success-surface! [&_[data-icon]]:text-success!',
          warning: '[&_[data-icon]]:bg-warning-surface! [&_[data-icon]]:text-warning!',
          error: '[&_[data-icon]]:bg-destructive-surface! [&_[data-icon]]:text-destructive!',
          info: '[&_[data-icon]]:bg-info-surface! [&_[data-icon]]:text-info!',
          // The medallion shell: a 36px soft square with the icon centered.
          // Sonner pins the slot to 16px and sets `justify-content: flex-start`
          // (icon hugs the left edge) — the `!` shape utilities override that so
          // the glyph sits dead-center. The neutral tint (`bg-muted`/
          // `text-foreground`) is deliberately NOT `!`: Sonner sets no icon
          // background to fight, and keeping it non-important lets the per-type
          // keys above win the color for typed toasts (an important neutral here
          // would outrank them by specificity and paint every medallion grey).
          icon: 'group-[.toast]:flex! group-[.toast]:size-9! group-[.toast]:shrink-0! group-[.toast]:items-center! group-[.toast]:justify-center! group-[.toast]:rounded-md! group-[.toast]:m-0! group-[.toast]:bg-muted group-[.toast]:text-foreground group-[.toast]:[&>svg]:size-icon! group-[.toast]:[&>svg]:m-0!',
          title:
            'group-[.toast]:text-foreground! group-[.toast]:text-sm! group-[.toast]:font-semibold!',
          // Calm secondary text — muted, never a second tone color.
          description: 'group-[.toast]:text-muted-foreground! group-[.toast]:text-xs!',
          // Outline action (white surface + hairline) — pops on the card without
          // shouting; cancel stays ghost-quiet. Own focus ring (shadow-focus):
          // Sonner's fixed black focus box-shadow is invisible on the card.
          actionButton:
            'group-[.toast]:rounded-md! group-[.toast]:border! group-[.toast]:border-border-strong! group-[.toast]:bg-card! group-[.toast]:px-sm! group-[.toast]:text-2xs! group-[.toast]:font-medium! group-[.toast]:text-foreground! group-[.toast]:hover:bg-muted! group-[.toast]:focus-visible:shadow-focus! group-[.toast]:focus-visible:outline-none!',
          cancelButton:
            'group-[.toast]:rounded-md! group-[.toast]:bg-transparent! group-[.toast]:px-sm! group-[.toast]:text-2xs! group-[.toast]:text-muted-foreground! group-[.toast]:hover:bg-muted! group-[.toast]:hover:text-foreground! group-[.toast]:focus-visible:shadow-focus! group-[.toast]:focus-visible:outline-none!',
          closeButton:
            'group-[.toast]:border-border! group-[.toast]:bg-card! group-[.toast]:text-muted-foreground! group-[.toast]:hover:text-foreground! group-[.toast]:focus-visible:shadow-focus! group-[.toast]:focus-visible:outline-none!',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
