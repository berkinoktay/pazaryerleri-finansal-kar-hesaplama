import { Host_Grotesk, JetBrains_Mono } from 'next/font/google';
import { getLocale } from 'next-intl/server';

import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/providers/theme-provider';
import { cn } from '@/lib/utils';

import './globals.css';

const hostGrotesk = Host_Grotesk({
  variable: '--font-host-grotesk',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  weight: ['400', '500', '600'],
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
