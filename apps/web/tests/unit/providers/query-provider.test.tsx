import { useMutation, useQuery } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QueryProvider } from '@/providers/query-provider';
import { ApiError } from '@/lib/api-error';

import trMessages from '../../../messages/tr.json';
import { problemApiError } from '../../helpers/api-error';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

/** The workbook conflicts the API answers as a 409, each under its own code. */
const WORKBOOK_CONFLICT_CODES = [
  'IMPORT_IN_PROGRESS',
  'UPLOAD_QUOTA_EXCEEDED',
  'STORED_FILE_MISSING',
  'STORED_FILE_UNREADABLE',
  'STORED_FILE_UNRECOGNIZED',
  'NO_WRITEBACK_COLUMN',
  'ROW_MISMATCH',
  'ROW_ANCHOR_MISMATCH',
  'ROW_NOT_FOUND',
  'EXPORT_FILENAME_COLLISION',
] as const;

const CONFLICT_STATUS = 409;
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

  it('does NOT toast NETWORK_ERROR while the browser is offline (NetworkStatusBanner owns this)', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    try {
      renderHook(
        () =>
          useQuery({
            queryKey: ['test', 'offline-network-error'],
            queryFn: () => {
              throw makeError('NETWORK_ERROR', 0);
            },
            retry: false,
          }),
        { wrapper },
      );

      await new Promise((r) => setTimeout(r, 20));
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        configurable: true,
        get: () => true,
      });
    }
  });

  it('DOES toast NETWORK_ERROR while the browser is online (genuine transport failure)', async () => {
    renderHook(
      () =>
        useQuery({
          queryKey: ['test', 'online-network-error'],
          queryFn: () => {
            throw makeError('NETWORK_ERROR', 0);
          },
          retry: false,
        }),
      { wrapper },
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('Bağlantı hatası. İnternetini kontrol et.');
  });

  it.each(WORKBOOK_CONFLICT_CODES)(
    'toasts the message of the workbook conflict %s once for a rejected mutation',
    async (code) => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => Promise.reject(problemApiError(CONFLICT_STATUS, code)),
          }),
        { wrapper },
      );
      result.current.mutate();

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledWith(trMessages.common.errors[code]);
    },
  );

  it('toasts the generic message for a 409 code it does not know', async () => {
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () =>
            Promise.reject(problemApiError(CONFLICT_STATUS, 'SOME_FUTURE_CONFLICT')),
        }),
      { wrapper },
    );
    result.current.mutate();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(trMessages.common.errors.generic);
  });
});
