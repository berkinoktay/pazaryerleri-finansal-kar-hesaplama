import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import trMessages from '../../messages/tr.json';

/**
 * Build a fresh QueryClient per test. Disables retries and caching so tests
 * are deterministic — no leftover state between tests, no flaky retry-induced
 * timing.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

function AllProviders({ children, queryClient }: ProvidersProps) {
  const client = queryClient ?? createTestQueryClient();
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/**
 * Render a React tree wrapped in all standard providers (QueryClient + NextIntl
 * with the Turkish message catalog). Components that call `useTranslations()`
 * get a real context here without per-test boilerplate.
 *
 * Returns the standard RTL render result plus a `user` instance for typing
 * and clicking — preferred over `fireEvent` per Testing Library guidance.
 */
export function render(
  ui: ReactElement,
  options: RenderOptions & { queryClient?: QueryClient } = {},
) {
  const { queryClient, ...rtlOptions } = options;
  const user = userEvent.setup();
  const result = rtlRender(ui, {
    wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders>,
    ...rtlOptions,
  });
  return { ...result, user };
}

export * from '@testing-library/react';
