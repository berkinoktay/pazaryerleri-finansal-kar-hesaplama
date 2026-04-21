'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganizations } from '@/features/organization/hooks/use-organizations';

/**
 * Dashboard panel listing the organizations the signed-in user belongs
 * to. First live consumer of the `/v1/organizations` endpoint — if the
 * auth-middleware chain (Supabase SSR cookie → Bearer header →
 * Hono authMiddleware → Prisma) is wired correctly, the names here
 * match what Supabase Studio shows under public.organizations.
 *
 * Error state renders the localized `loadError` copy plus a retry
 * button wired to the query's `refetch` — the user can recover
 * without a full page reload. `common.errors.*` toasts from the
 * global onError still fire; inline UI + toast are complementary.
 */
export function OrganizationsPanel(): React.ReactElement {
  const t = useTranslations('organizations.panel');
  const tCommon = useTranslations('common');
  const { data, isLoading, isError, isFetching, refetch } = useOrganizations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="gap-xs flex flex-col">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-56" />
          </div>
        ) : isError ? (
          <div className="gap-sm flex flex-col items-start" role="alert">
            <p className="text-destructive text-sm">{t('loadError')}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void refetch();
              }}
              disabled={isFetching}
            >
              {tCommon('retry')}
            </Button>
          </div>
        ) : data === undefined || data.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="gap-xs flex flex-col">
            {data.map((org) => (
              <li
                key={org.id}
                className="border-border bg-muted/40 px-sm py-xs flex items-center justify-between rounded-md border text-sm"
              >
                <span className="text-foreground font-medium">{org.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{org.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
