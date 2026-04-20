'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrganizations } from '@/features/organization/hooks/use-organizations';

/**
 * Dashboard panel listing the organizations the signed-in user belongs
 * to. First live consumer of the `/v1/organizations` endpoint — if the
 * auth-middleware chain (Supabase SSR cookie → Bearer header →
 * Hono authMiddleware → Prisma) is wired correctly, the names here
 * match what Supabase Studio shows under public.organizations.
 */
export function OrganizationsPanel(): React.ReactElement {
  const t = useTranslations('organizations.panel');
  const { data, isLoading, isError } = useOrganizations();

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
          <p className="text-destructive text-sm">{t('loadError')}</p>
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
