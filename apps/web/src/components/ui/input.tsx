import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const inputVariants = cva(
  [
    'flex w-full border border-border bg-background text-foreground shadow-xs transition-colors duration-fast',
    'placeholder:text-muted-foreground',
    'hover:border-border-strong',
    'focus-visible:border-ring focus-visible:outline-none',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'file:border-0 file:bg-transparent file:text-sm file:font-medium',
    'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 px-sm py-3xs text-xs',
        md: 'h-10 px-sm py-xs text-sm',
        lg: 'h-11 px-md py-xs text-base',
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

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size, radius, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(inputVariants({ size, radius, className }))}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { inputVariants };
