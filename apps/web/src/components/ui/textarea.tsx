import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const textareaVariants = cva(
  [
    'flex w-full border border-border bg-background text-foreground shadow-xs transition-colors duration-fast',
    'placeholder:text-muted-foreground',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-destructive',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'min-h-16 px-sm py-xs text-xs',
        md: 'min-h-20 px-sm py-xs text-sm',
        lg: 'min-h-24 px-md py-sm text-base',
      },
      radius: {
        none: 'rounded-none',
        xs: 'rounded-xs',
        sm: 'rounded-sm',
        md: 'rounded-md',
        lg: 'rounded-lg',
        xl: 'rounded-xl',
        '2xl': 'rounded-2xl',
        full: 'rounded-full',
      },
    },
    defaultVariants: { size: 'md', radius: 'md' },
  },
);

export interface TextareaProps
  extends
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, radius, ...props }, ref) => (
    <textarea ref={ref} className={cn(textareaVariants({ size, radius, className }))} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export { textareaVariants };
