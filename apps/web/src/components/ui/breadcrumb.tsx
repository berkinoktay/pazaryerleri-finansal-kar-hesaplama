import { ArrowRight01Icon, MoreHorizontalCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Trail of links showing the user's location in the site hierarchy.
 * Reach for it on detail pages where the back-path matters
 * (Org → Store → Order #1234) — flat list pages don't need a
 * breadcrumb. Use `BreadcrumbEllipsis` to collapse a long middle
 * segment on narrow viewports; the sr-only label reads from
 * `t('common.more')` so it requires NextIntlClientProvider upstream.
 *
 * @useWhen rendering a hierarchical location trail on a detail page where the parent context matters (skip on flat list or single-level pages)
 */
export const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'nav'>>(
  ({ className, ...props }, ref) => (
    <nav ref={ref} aria-label="breadcrumb" className={className} {...props} />
  ),
);
Breadcrumb.displayName = 'Breadcrumb';

export const BreadcrumbList = React.forwardRef<
  HTMLOListElement,
  React.ComponentPropsWithoutRef<'ol'>
>(({ className, ...props }, ref) => (
  <ol
    ref={ref}
    className={cn('gap-3xs text-2xs text-muted-foreground flex flex-wrap items-center', className)}
    {...props}
  />
));
BreadcrumbList.displayName = 'BreadcrumbList';

export const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('gap-3xs inline-flex items-center', className)} {...props} />
  ),
);
BreadcrumbItem.displayName = 'BreadcrumbItem';

export const BreadcrumbLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentPropsWithoutRef<'a'> & { asChild?: boolean }
>(({ className, ...props }, ref) => (
  <a
    ref={ref}
    className={cn(
      'px-3xs duration-fast hover:text-foreground rounded-sm transition-colors focus-visible:outline-none',
      className,
    )}
    {...props}
  />
));
BreadcrumbLink.displayName = 'BreadcrumbLink';

export const BreadcrumbPage = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<'span'>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    aria-current="page"
    className={cn('px-3xs text-foreground font-medium', className)}
    {...props}
  />
));
BreadcrumbPage.displayName = 'BreadcrumbPage';

export function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'li'>): React.ReactElement {
  return (
    <li
      role="presentation"
      aria-hidden="true"
      className={cn('text-muted-foreground [&>svg]:size-icon-xs', className)}
      {...props}
    >
      {children ?? <ArrowRight01Icon />}
    </li>
  );
}

export function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<'span'>): React.ReactElement {
  const t = useTranslations('common');
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn('size-icon-sm inline-flex items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalCircle01Icon className="size-icon-sm" />
      <span className="sr-only">{t('more')}</span>
    </span>
  );
}
