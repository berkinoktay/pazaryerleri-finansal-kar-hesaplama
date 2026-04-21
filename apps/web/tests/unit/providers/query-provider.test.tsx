import { useQuery } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QueryProvider } from '@/providers/query-provider';
import { ApiError } from '@/lib/api-error';

import trMessages from '../../../messages/tr.json';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <QueryProvider>{children}</QueryProvider>
    </NextIntlClientProvider>
  );
}

function makeError(code: string, status = 500): ApiError {
  return new ApiError(status, code, `${code} detail`, {
    type: 'https://api.pazarsync.com/errors/test',
    title: code,
    status,
    code,
    detail: `${code} detail`,
  });
}

beforeEach(() => {
  toastError.mockReset();
});

describe('QueryProvider', () => {
  it('toasts the Turkish message for the ApiError code on unhandled query errors', async () => {
    renderHook(
      () =>
        useQuery({
          queryKey: ['test', 'fail'],
          queryFn: () => {
            throw makeError('NOT_FOUND', 404);
          },
          retry: false,
        }),
      { wrapper },
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('Aradığın kaynağı bulamadık.');
  });

  it('does NOT toast when meta.silent is set', async () => {
    renderHook(
      () =>
        useQuery({
          queryKey: ['test', 'silent'],
          queryFn: () => {
            throw makeError('INTERNAL_ERROR');
          },
          retry: false,
          meta: { silent: true },
        }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does NOT toast VALIDATION_ERROR (forms handle inline)', async () => {
    renderHook(
      () =>
        useQuery({
          queryKey: ['test', 'validation'],
          queryFn: () => {
            throw makeError('VALIDATION_ERROR', 422);
          },
          retry: false,
        }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does NOT toast UNAUTHENTICATED (SessionExpiredHandler owns this)', async () => {
    renderHook(
      () =>
        useQuery({
          queryKey: ['test', 'auth'],
          queryFn: () => {
            throw makeError('UNAUTHENTICATED', 401);
          },
          retry: false,
        }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(toastError).not.toHaveBeenCalled();
  });
});
