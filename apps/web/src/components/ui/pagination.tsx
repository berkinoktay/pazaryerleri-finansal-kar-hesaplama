import { ArrowLeft01Icon, ArrowRight01Icon, MoreHorizontalCircle01Icon } from 'hugeicons-react';
import * as React from 'react';

import { type ButtonProps, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Pagination({
  className,
  ...props
}: React.ComponentProps<'nav'>): React.ReactElement {
  return (
    <nav
      role="navigation"
      aria-label="Sayfalama"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
}

export const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('gap-3xs flex flex-row items-center', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

export const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn('', className)} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';

interface PaginationLinkProps extends Pick<ButtonProps, 'size'>, React.ComponentProps<'a'> {
  isActive?: boolean;
}

export function PaginationLink({
  className,
  isActive,
  size = 'icon-sm',
  ...props
}: PaginationLinkProps): React.ReactElement {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'outline' : 'ghost', size }),
        'tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement {
  return (
    <PaginationLink
      aria-label="Önceki sayfa"
      size="sm"
      className={cn('gap-3xs px-xs', className)}
      {...props}
    >
      <ArrowLeft01Icon className="size-icon-sm" />
      <span>Önceki</span>
    </PaginationLink>
  );
}

export function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement {
  return (
    <PaginationLink
      aria-label="Sonraki sayfa"
      size="sm"
      className={cn('gap-3xs px-xs', className)}
      {...props}
    >
      <span>Sonraki</span>
      <ArrowRight01Icon className="size-icon-sm" />
    </PaginationLink>
  );
}

export function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<'span'>): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn('text-muted-foreground flex size-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalCircle01Icon className="size-icon-sm" />
      <span className="sr-only">Daha fazla</span>
    </span>
  );
}
