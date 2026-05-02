import {
  ArrowRight01Icon,
  ChartLineData01Icon,
  InvoiceIcon,
  ReceiptDollarIcon,
} from 'hugeicons-react';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { Button } from '@/components/ui/button';
import { routing } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';

const VALUE_PROPS = [
  { key: 'profit', icon: ChartLineData01Icon },
  { key: 'reconciliation', icon: InvoiceIcon },
  { key: 'expenses', icon: ReceiptDollarIcon },
] as const;

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const tNav = await getTranslations('landing.nav');
  const tHero = await getTranslations('landing.hero');
  const tProps = await getTranslations('landing.valueProps');
  const tFooter = await getTranslations('landing.footer');

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <div className="max-w-content-max px-lg py-md mx-auto flex items-center justify-between">
          <Wordmark />
          <nav className="gap-sm flex items-center">
            {/*
             * The "Design system" link previously rendered here was removed:
             * Phase 0 auth-gated /design (it's an internal reference, not
             * customer-facing content), so a public-marketing link to it is
             * misleading — clicking it just funnels through the login wall.
             * Devs/stakeholders who need it still reach it via direct URL.
             * The `landing.nav.designSystem` translation key is intentionally
             * kept in the messages file so it can come back as a conditional
             * (e.g. dev-only badge) without re-translating.
             */}
            <LanguageSwitcher variant="compact" />
            <Button asChild variant="outline" size="sm">
              <Link href="/login">{tNav('login')}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">{tNav('signup')}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="max-w-content-max gap-4xl px-lg py-4xl mx-auto flex flex-col">
        <section className="gap-lg flex flex-col items-start">
          <span className="border-border bg-muted px-sm py-3xs text-2xs text-muted-foreground rounded-full border font-medium tracking-wide uppercase">
            {tHero('eyebrow')}
          </span>
          <h1 className="text-foreground max-w-headline text-5xl font-bold tracking-tight">
            {tHero('titlePrefix')} <span className="text-primary">{tHero('titleHighlight')}</span>{' '}
            {tHero('titleSuffix')}
          </h1>
          <p className="max-w-prose-max text-muted-foreground text-lg">{tHero('subtitle')}</p>
          <div className="gap-xs flex items-center">
            <Button asChild size="lg">
              <Link href="/register">
                {tHero('ctaPrimary')} <ArrowRight01Icon className="size-icon-sm" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/design/layout-demo">{tHero('ctaSecondary')}</Link>
            </Button>
          </div>
        </section>

        <section className="gap-lg grid sm:grid-cols-3">
          {VALUE_PROPS.map(({ key, icon: Icon }) => (
            <div key={key} className="gap-sm flex flex-col">
              <div className="size-icon-xl bg-muted text-primary flex items-center justify-center rounded-md">
                <Icon className="size-icon" />
              </div>
              <h2 className="text-foreground text-lg font-semibold">{tProps(`${key}.title`)}</h2>
              <p className="text-muted-foreground text-sm">{tProps(`${key}.description`)}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-border border-t">
        <div className="max-w-content-max px-lg py-lg text-2xs text-muted-foreground mx-auto flex items-center justify-between">
          <span>{tFooter('copyright', { year: new Date().getFullYear() })}</span>
          <span>{tFooter('tagline')}</span>
        </div>
      </footer>
    </div>
  );
}
