'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Cancel01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Lightbox modal for inspecting an image at original resolution. Composes
 * the Dialog primitive with a transparent shell — the image itself stays
 * the visual focus, capped at 90vw × 90vh so it always fits the viewport
 * with breathing room. Backdrop click, Esc, or the top-right close chip
 * dismiss.
 *
 * Controlled-open API: parent owns the `open` state (typically a
 * `useState` next to a clickable thumbnail). Returns `null` when `src`
 * is missing or empty — pair with a trigger that's disabled in the same
 * condition so the modal never tries to render against a null source.
 *
 * @useWhen wrapping a thumbnail cell so users can inspect a product / asset image at original resolution (pair with a clickable button around the thumbnail and a useState for open / onOpenChange)
 */
export interface ImageModalProps {
  src: string | null | undefined;
  alt: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function ImageModal({
  src,
  alt,
  open,
  onOpenChange,
}: ImageModalProps): React.ReactElement | null {
  const t = useTranslations('common');
  if (src === null || src === undefined || src.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-foreground/60" />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'duration-base ease-out-quart',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'focus-visible:outline-none',
          )}
          aria-describedby={undefined}
        >
          {/* Required by Radix for accessibility — read aloud on open. */}
          <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
          <div className="relative">
            <img
              src={src}
              alt={alt}
              // `image-modal-img` is a token-driven class defined in
              // tokens/components.css that caps the image at 90vw / 90vh —
              // viewport-relative values aren't expressible as a Tailwind
              // `max-w-*` utility cleanly, so the wrapper class is the
              // documented escape hatch.
              className="image-modal-img rounded-lg object-contain shadow-xl"
            />
            <DialogPrimitive.Close
              aria-label={t('close')}
              className={cn(
                'top-sm right-sm absolute size-9 rounded-full',
                // Scrim over user-generated imagery — alpha is acceptable
                // here per the design system rule (real backdrop, not a
                // palette shortcut). Stays legible against any photo.
                'bg-foreground/50 text-background hover:bg-foreground/70 backdrop-blur-md',
                'duration-fast flex items-center justify-center transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              <Cancel01Icon className="size-icon-sm" />
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
