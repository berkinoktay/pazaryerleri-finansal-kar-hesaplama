import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Render a React tree wrapped in all standard providers (QueryClient for now;
 * add more here as the app grows: theme, i18n, auth context, etc).
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
