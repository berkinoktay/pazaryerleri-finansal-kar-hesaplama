import React from 'react';
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { renderHook } from '@testing-library/react';

import { useFormatSyncError } from '@/features/sync/lib/format-sync-error';

const messages = {
  syncCenter: {
    errors: {
      MARKETPLACE_AUTH_FAILED: {
        title: 'Kimlik doğrulama başarısız',
        description:
          'API bilgileri pazar yeri tarafından reddedildi. Mağaza ayarlarındaki anahtarları kontrol et.',
      },
      MARKETPLACE_UNREACHABLE: {
        title: 'Pazar yerine ulaşılamıyor',
        description: 'Pazar yerinin sunucuları geçici olarak yanıt vermiyor.',
      },
      fallback: {
        title: 'Bilinmeyen hata',
        description: 'Bir aksaklık oldu. Sorun devam ederse destek ekibimize ulaş.',
      },
    },
  },
};

function wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <NextIntlClientProvider locale="tr" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

describe('useFormatSyncError', () => {
  it('returns null when the code is null', () => {
    const { result } = renderHook(() => useFormatSyncError(), { wrapper });
    expect(result.current(null)).toBeNull();
  });

  it('returns null when the code is undefined', () => {
    const { result } = renderHook(() => useFormatSyncError(), { wrapper });
    expect(result.current(undefined)).toBeNull();
  });

  it('returns translated copy for a known code', () => {
    const { result } = renderHook(() => useFormatSyncError(), { wrapper });
    expect(result.current('MARKETPLACE_AUTH_FAILED')).toEqual({
      title: 'Kimlik doğrulama başarısız',
      description:
        'API bilgileri pazar yeri tarafından reddedildi. Mağaza ayarlarındaki anahtarları kontrol et.',
    });
  });

  it('returns fallback copy for an unknown code (no raw enum leak)', () => {
    const { result } = renderHook(() => useFormatSyncError(), { wrapper });
    expect(result.current('BRAND_NEW_UNKNOWN_CODE')).toEqual({
      title: 'Bilinmeyen hata',
      description: 'Bir aksaklık oldu. Sorun devam ederse destek ekibimize ulaş.',
    });
  });
});
