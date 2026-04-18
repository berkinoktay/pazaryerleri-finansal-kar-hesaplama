'use client';

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes';

const STORAGE_KEY = 'pazarsync.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}

export const useTheme = useNextTheme;
