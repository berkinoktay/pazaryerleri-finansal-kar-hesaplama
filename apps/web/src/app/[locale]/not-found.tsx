import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';

export default async function NotFound(): Promise<React.ReactElement> {
  const t = await getTranslations('notFound');
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="gap-lg max-w-form px-lg flex flex-col text-center">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
        <Button variant="ghost" asChild>
          <Link href="/">{t('home')}</Link>
        </Button>
      </div>
    </main>
  );
}
