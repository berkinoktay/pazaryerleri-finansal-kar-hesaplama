import { AuthApiError } from '@supabase/supabase-js';
import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { useSignOut } from '@/features/auth/hooks/use-sign-out';

import { createTestQueryClient } from '../../helpers/render';
import trMessages from '../../../messages/tr.json';

const signOutMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: signOutMock } }),
}));

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

const pushMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe('useSignOut', () => {
  it('toasts the Turkish error message when Supabase rejects the sign-out', async () => {
    signOutMock.mockResolvedValueOnce({
      error: new AuthApiError('network', 500, 'unexpected_failure'),
    });

    const { result } = renderHook(() => useSignOut(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('Çıkış yapılamadı. Lütfen tekrar dene.');
  });
});
