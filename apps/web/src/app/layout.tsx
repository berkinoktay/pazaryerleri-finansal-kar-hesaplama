import type { Metadata } from 'next';
import { Host_Grotesk, JetBrains_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IntlProvider } from '@/providers/intl-provider';
import { QueryProvider } from '@/providers/query-provider';
import { ThemeProvider, ThemeScript } from '@/providers/theme-provider';
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

export const metadata: Metadata = {
  title: {
    default: 'PazarSync — E-ticaret Karlılık ve Operasyon Yönetimi',
    template: '%s · PazarSync',
  },
  description:
    'Türkiye pazaryerlerinde satış yapan işletmeler için sipariş bazında gerçek karlılık, otomatik mutabakat ve gider yönetimi platformu.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={cn(hostGrotesk.variable, jetBrainsMono.variable, 'h-full antialiased')}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="bg-background text-foreground min-h-full">
        <ThemeProvider>
          <IntlProvider>
            <QueryProvider>
              <TooltipProvider delayDuration={200} skipDelayDuration={300}>
                {children}
                <Toaster />
              </TooltipProvider>
            </QueryProvider>
          </IntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
