import { ArrowLeft01Icon, ArrowRight01Icon, MoreHorizontalCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { type ButtonProps, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Page-by-page navigation for paged list views (orders, products,
 * settlements). Compose `PaginationContent`, `PaginationItem`,
 * `PaginationLink` (with `isActive` for the current page),
 * `PaginationPrevious` / `PaginationNext`, and `PaginationEllipsis` for
 * collapsed middle ranges. All labels (nav aria-label, prev / next
 * text + aria-label, "more" sr-only) read from `t('common.pagination.*')`.
 *
 * @useWhen rendering page-by-page navigation for a paginated list (use cursor-based "Load more" for infinite feeds, virtual scrolling for huge tables)
 */

export function Pagination({
  className,
  ...props
}: React.ComponentProps<'nav'>): React.ReactElement {
  const t = useTranslations('common.pagination');
  return (
    <nav
      role="navigation"
      aria-label={t('label')}
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
  ({ className, ...props }, ref) => <li ref={ref} className={cn(className)} {...props} />,
);
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkOwnProps = Pick<ButtonProps, 'size'> & {
  isActive?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Renders an `<a>` for URL-driven navigation (pass `href`) or a `<button>` for
 * state-driven navigation (omit `href`, pass `onClick` — e.g. a TanStack table
 * footer). Both are natively focusable + disable-able; the `<a>` fallback can't
 * be natively disabled, so it uses `aria-disabled` + tab removal instead.
 */
export type PaginationLinkProps = PaginationLinkOwnProps &
  // The two members are kept mutually exclusive: each omits the OTHER
  // element's branch-specific attributes (anchor drops `type`; button drops
  // `href` / `download`) so a miswritten call site (e.g. `type` on the anchor
  // branch) is a type error, not a silent stray DOM attribute.
  (| ({ href: string } & Omit<React.ComponentProps<'a'>, 'href' | 'className' | 'type'>)
    | ({ href?: undefined } & Omit<
        React.ComponentProps<'button'>,
        'className' | 'disabled' | 'type' | 'href' | 'download'
      >)
  );

function paginationLinkClasses(
  { isActive, size }: Pick<PaginationLinkOwnProps, 'isActive' | 'size'>,
  inert: string,
  className: string | undefined,
): string {
  return cn(
    buttonVariants({ variant: 'ghost', size: size ?? 'icon-sm' }),
    // Active page reads as a genuine selection: a soft primary surface with
    // medium weight. Suppress the ghost hover so it doesn't flip its fill on
    // hover the way a navigable page does.
    isActive && 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft font-medium',
    'tabular-nums',
    inert,
    className,
  );
}

export function PaginationLink(props: PaginationLinkProps): React.ReactElement {
  if (props.href !== undefined) {
    const { isActive, disabled, size, className, href, ...anchorProps } = props;
    return (
      <a
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        tabIndex={disabled ? -1 : undefined}
        href={disabled ? undefined : href}
        className={paginationLinkClasses(
          { isActive, size },
          'aria-disabled:pointer-events-none aria-disabled:opacity-50',
          className,
        )}
        {...anchorProps}
      />
    );
  }

  const { isActive, disabled, size, className, ...buttonProps } = props;
  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      disabled={disabled}
      className={paginationLinkClasses(
        { isActive, size },
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...buttonProps}
    />
  );
}

export function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement {
  const t = useTranslations('common.pagination');
  return (
    <PaginationLink
      aria-label={t('previousPage')}
      size="sm"
      className={cn('gap-3xs px-xs', className)}
      {...props}
    >
      <ArrowLeft01Icon className="size-icon-sm" />
      <span>{t('previous')}</span>
    </PaginationLink>
  );
}

export function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement {
  const t = useTranslations('common.pagination');
  return (
    <PaginationLink
      aria-label={t('nextPage')}
      size="sm"
      className={cn('gap-3xs px-xs', className)}
      {...props}
    >
      <span>{t('next')}</span>
      <ArrowRight01Icon className="size-icon-sm" />
    </PaginationLink>
  );
}

export function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<'span'>): React.ReactElement {
  const t = useTranslations('common');
  return (
    <span
      aria-hidden
      className={cn('text-muted-foreground flex size-8 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalCircle01Icon className="size-icon-sm" />
      <span className="sr-only">{t('more')}</span>
    </span>
  );
}
