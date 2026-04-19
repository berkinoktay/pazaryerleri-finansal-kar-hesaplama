import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';

// Stub Supabase env so module-scope factories (api-client/browser,
// auth hooks) don't throw at import time. Values are placeholders —
// MSW intercepts outbound fetches before Supabase can actually reach
// the "server".
process.env['NEXT_PUBLIC_SUPABASE_URL'] ??= 'http://localhost:54321';
process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ??= 'sb_publishable_test';

import { server } from './helpers/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
