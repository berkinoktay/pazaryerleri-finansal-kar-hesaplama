import localFont from 'next/font/local';
import { getLocale } from 'next-intl/server';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/providers/theme-provider';
import { cn } from '@/lib/utils';

import './globals.css';

// Both brand fonts are self-hosted variable woff2 files (see ./fonts/README.md).
// They used to come from next/font/google, but Google intermittently serves
// extensionless font URLs that Turbopack cannot resolve (vercel/next.js#99114),
// which broke `next dev` and `next build` at random. Local files also remove
// the build-time network dependency entirely.
const hostGrotesk = localFont({
  src: './fonts/host-grotesk-wght.woff2',
  variable: '--font-host-grotesk',
  display: 'swap',
  weight: '300 800',
});

const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono-wght.woff2',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: '100 800',
});

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(hostGrotesk.variable, jetBrainsMono.variable, 'h-full antialiased')}
    >
      <head />
      <body className="bg-background text-foreground min-h-full">
        <ThemeProvider>
          <TooltipProvider delayDuration={200} skipDelayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
