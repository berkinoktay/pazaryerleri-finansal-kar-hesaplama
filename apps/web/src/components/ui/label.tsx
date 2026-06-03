'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Accessible text caption for a form control. Always pair every
 * Input / Textarea / Select / Checkbox / RadioGroupItem / Switch with a
 * `<Label htmlFor>` — placeholders are not labels (they vanish when the
 * field has a value, leaving screen readers without context).
 *
 * `required` appends a decorative `*` marker. It is presentation only — the
 * control itself must still carry `required` (which gives `aria-required`):
 *
 * @example
 * <Label htmlFor="email" required>E-posta</Label>
 * <Input id="email" required />
 *
 * `hint` is an inline slot after the label — typically a Tooltip-wrapped info
 * icon for one-line field guidance (Desi, KDV oranı, API secret) without
 * cluttering a FormDescription. The error tone is applied by FormLabel (it
 * adds `text-destructive`) and eases in via the base `transition-colors`.
 *
 * `peer-disabled:` dims the label ONLY in the inline Checkbox / Radio / Switch
 * layout where the control is a PRECEDING `peer` sibling (`<Checkbox class="peer">`
 * then `<Label>`). For the common top-stacked layout (label THEN input) the
 * label is the earlier sibling, so peer-disabled cannot fire — there, disabled
 * styling is driven at the form level (FormItem `data-disabled`), not via CSS
 * peer. An "optional" hint is language-specific — pass that copy in `children`
 * or a FormDescription so the primitive stays i18n-neutral.
 *
 * @useWhen attaching an accessible text caption to a form control via htmlFor (placeholders are not labels)
 */
export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Appends a decorative required marker (`*`). Presentation only — the field must still set `required` / `aria-required`. */
  required?: boolean;
  /** Inline help slot after the label — typically a Tooltip-wrapped info icon for contextual field guidance. SVGs auto-sized. */
  hint?: React.ReactNode;
}

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, hint, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-foreground duration-fast ease-out-quart text-sm leading-none font-medium transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {children}
      {required === true ? (
        <span aria-hidden="true" className="text-destructive ml-3xs">
          *
        </span>
      ) : null}
      {hint !== undefined ? (
        <span className="ml-2xs text-muted-foreground inline-flex items-center align-middle [&_svg]:size-3.5">
          {hint}
        </span>
      ) : null}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;
