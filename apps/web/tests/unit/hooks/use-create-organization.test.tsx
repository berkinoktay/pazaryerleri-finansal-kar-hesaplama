import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { ApiError } from '@/lib/api-error';

import { useCreateOrganization } from '@/features/organization/hooks/use-create-organization';
import trMessages from '../../../messages/tr.json';

import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const setActiveOrgIdMock = vi.fn<(orgId: string) => Promise<void>>(async () => undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/lib/active-org-actions', () => ({
  setActiveOrgIdAction: (...args: [string]) => setActiveOrgIdMock(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider messages={trMessages} locale="tr">
      <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

describe('useCreateOrganization', () => {
  it('sets the cookie, invalidates queries, and pushes to /onboarding/connect-store on 201', async () => {
    server.use(
      http.post('http://localhost:3001/v1/organizations', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json(
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: body.name,
            slug: 'akyildiz-ticaret',
            currency: 'TRY',
            timezone: 'Europe/Istanbul',
            createdAt: '2026-04-20T10:00:00Z',
            updatedAt: '2026-04-20T10:00:00Z',
            membership: { role: 'OWNER' },
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHook(() => useCreateOrganization(), { wrapper });

    result.current.mutate({ name: 'Akyıldız Ticaret' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(setActiveOrgIdMock).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
    expect(pushMock).toHaveBeenCalledWith('/onboarding/connect-store');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('surfaces an error on 400 validation failure', async () => {
    server.use(
      http.post('http://localhost:3001/v1/organizations', () => {
        return HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/validation',
            title: 'Validation Error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'Validation failed',
          },
          { status: 422 },
        );
      }),
    );

    const { result } = renderHook(() => useCreateOrganization(), { wrapper });
    result.current.mutate({ name: 'A' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('VALIDATION_ERROR');
  });

  it('exposes the backend validation issues on a VALIDATION_ERROR', async () => {
    server.use(
      http.post('http://localhost:3001/v1/organizations', () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/validation',
            title: 'Validation error',
            status: 422,
            code: 'VALIDATION_ERROR',
            detail: 'name too short',
            errors: [{ field: 'name', code: 'INVALID_NAME_TOO_SHORT' }],
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(() => useCreateOrganization(), { wrapper });
    result.current.mutate({ name: 'A' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('VALIDATION_ERROR');
    expect((error as ApiError).problem.errors).toEqual([
      { field: 'name', code: 'INVALID_NAME_TOO_SHORT' },
    ]);
  });
});
