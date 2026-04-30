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
 * input is disabled.
 *
 * @useWhen attaching an accessible text caption to a form control via htmlFor (placeholders are not labels)
 */
export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-foreground text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
