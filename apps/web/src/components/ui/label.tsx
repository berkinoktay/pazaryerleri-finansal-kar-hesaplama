'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Accessible text caption for a form control. Always pair every
 * Input / Textarea / Select / Checkbox / RadioGroupItem / Switch with a
 * `<Label htmlFor>` — placeholders are not labels (they vanish when the
 * field has a value, leaving screen readers without context). The
 * `peer-disabled:` state automatically dims the label when its peer
 * input is disabled. Pass `required` for a decorative `*` marker; the
 * error tone is applied by FormLabel (it adds `text-destructive`) and eases
 * in via the base `transition-colors`. An "optional" hint is language-
 * specific — pass that copy in `children` or a FormDescription so the
 * primitive stays i18n-neutral.
 *
 * @useWhen attaching an accessible text caption to a form control via htmlFor (placeholders are not labels)
 */
export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Appends a decorative required marker (`*`). Presentation only — the field must still set `required` / `aria-required`. */
  required?: boolean;
}

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
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
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;
