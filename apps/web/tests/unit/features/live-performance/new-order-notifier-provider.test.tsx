import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeHealth } from '@/lib/supabase/realtime';
import {
  NewOrderNotifierProvider,
  useNewOrderNotifier,
} from '@/features/live-performance/providers/new-order-notifier-provider';

import { createTestQueryClient } from '../../../helpers/render';
import trMessages from '../../../../messages/tr.json';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';

let emitHealthChange: (h: RealtimeHealth) => void = () => {};
const unsubscribeMock = vi.fn();

interface MockOptions {
  onEvent: () => void;
  onNewOrder?: (e: { table: 'orders' | 'buffer'; id: string }) => void;
  onHealthChange?: (h: RealtimeHealth) => void;
}

vi.mock('@/lib/supabase/realtime', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/supabase/realtime')>('@/lib/supabase/realtime');
  return {
    ...actual,
    subscribeToLivePerformance: (_storeId: string, options: MockOptions): (() => void) => {
      emitHealthChange = options.onHealthChange ?? (() => {});
      return unsubscribeMock;
    },
  };
});

vi.mock('@/providers/current-scope', () => ({
  useCurrentScope: () => ({ org: { id: ORG_ID }, store: { id: STORE_ID } }),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <NextIntlClientProvider locale="tr" messages={trMessages} timeZone="Europe/Istanbul">
        <NewOrderNotifierProvider>{children}</NewOrderNotifierProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  unsubscribeMock.mockClear();
  emitHealthChange = () => {};
});
afterEach(() => vi.useRealTimers());

describe('NewOrderNotifierProvider', () => {
  it('exposes channel health and reflects transitions', async () => {
    const { result } = renderHook(() => useNewOrderNotifier(), { wrapper });
    expect(result.current.health).toBe('connecting');
    act(() => emitHealthChange('healthy'));
    await waitFor(() => expect(result.current.health).toBe('healthy'));
  });

  it('cleans up the subscription on unmount', () => {
    const { unmount } = renderHook(() => useNewOrderNotifier(), { wrapper });
    expect(unsubscribeMock).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        renderHook(() => useNewOrderNotifier(), {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
          ),
        }),
      ).toThrow(/must be used inside NewOrderNotifierProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
