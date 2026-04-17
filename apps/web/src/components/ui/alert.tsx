import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex w-full items-start gap-sm border [&>svg]:mt-3xs [&>svg]:size-icon-sm [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-foreground [&>svg]:text-muted-foreground',
        info: 'border-transparent bg-info-surface text-info [&>svg]:text-info',
        success: 'border-transparent bg-success-surface text-success [&>svg]:text-success',
        warning: 'border-transparent bg-warning-surface text-warning [&>svg]:text-warning',
        destructive:
          'border-transparent bg-destructive-surface text-destructive [&>svg]:text-destructive',
      },
      size: {
        sm: 'px-sm py-xs text-xs',
        md: 'px-md py-sm text-sm',
        lg: 'px-lg py-md text-base',
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
    defaultVariants: { tone: 'neutral', size: 'md', radius: 'md' },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone, size, radius, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ tone, size, radius, className }))}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-3xs leading-tight font-semibold', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('opacity-90 [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { alertVariants };
