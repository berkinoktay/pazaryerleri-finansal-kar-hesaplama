// Component test for SyncCenter — locks the §68 fix in place: a
// FAILED_RETRYABLE row MUST render in the "Yeniden deneniyor" section
// (not collapsed back into "Geçmiş"), the retry trigger MUST be
// disabled while one exists, and the row MUST surface errorCode +
// retry timing + attempt count.

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

import {
  SyncCenter,
  type SyncCenterLog,
  type SyncCenterTriggerSpec,
} from '@/components/patterns/sync-center';
import { FORMATS } from '@/i18n/formats';
import { render, screen } from '@/../tests/helpers/render';

// Minimal subset of `syncCenter.*` keys the component consumes. Real
// translations can drift; the test only cares the right key was
// looked up and substitution worked.
const messages = {
  syncCenter: {
    title: 'Senkronizasyon',
    description: 'Aktif ve son senkronizasyonlar',
    sections: {
      active: 'Çalışıyor',
      retrying: 'Yeniden deneniyor',
      recent: 'Geçmiş',
    },
    status: {
      pending: 'Kuyrukta',
      running: 'Çalışıyor',
      retrying: 'Yeniden deneniyor',
      completed: 'Tamamlandı',
      failed: 'Başarısız',
    },
    triggers: {
      PRODUCTS: 'Ürünleri şimdi senkronize et',
      ORDERS: 'Siparişleri şimdi senkronize et',
      SETTLEMENTS: 'Hakedişleri şimdi senkronize et',
    },
    syncTypeLabel: {
      PRODUCTS: 'Ürün senkronu',
      ORDERS: 'Sipariş senkronu',
      SETTLEMENTS: 'Hakediş senkronu',
    },
    completedSummary: '{n} kayıt işlendi',
    completedWithSkipsSummary:
      '{n} kayıt işlendi · {skipped} sayfa Trendyol tarafından sağlanamadı',
    skippedChip: '{n} sayfa atlandı',
    failedSummary: 'Hata',
    willRetry: 'Yeniden denenecek {when}',
    willRetryUnknown: 'Yeniden denenecek',
    attempt: 'Deneme {n}',
    empty: 'Henüz senkronizasyon yok.',
    unknownStore: 'Bilinmeyen mağaza',
    errors: {
      MARKETPLACE_UNREACHABLE: {
        title: 'Pazar yerine ulaşılamıyor',
        description: 'Pazar yerinin sunucuları geçici olarak yanıt vermiyor.',
      },
      MARKETPLACE_AUTH_FAILED: {
        title: 'Kimlik doğrulama başarısız',
        description:
          'API bilgileri pazar yeri tarafından reddedildi. Mağaza ayarlarındaki anahtarları kontrol et.',
      },
      fallback: {
        title: 'Bilinmeyen hata',
        description: 'Bir aksaklık oldu. Sorun devam ederse destek ekibimize ulaş.',
      },
    },
  },
};

function renderCenter(
  props: Partial<React.ComponentProps<typeof SyncCenter>> = {},
): ReturnType<typeof render> {
  const onOpenChange = vi.fn();
  const trigger: SyncCenterTriggerSpec = {
    syncType: 'PRODUCTS',
    onClick: vi.fn(),
    isPending: false,
  };
  return render(
    <NextIntlClientProvider locale="tr" messages={messages} formats={FORMATS} timeZone="UTC">
      <SyncCenter open onOpenChange={onOpenChange} logs={[]} triggers={[trigger]} {...props} />
    </NextIntlClientProvider>,
  );
}

function makeRetryableLog(overrides: Partial<SyncCenterLog> = {}): SyncCenterLog {
  return {
    id: 'log-retry-1',
    storeId: 'store-1',
    syncType: 'PRODUCTS',
    status: 'FAILED_RETRYABLE',
    startedAt: '2026-04-28T10:00:00.000Z',
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: 2400,
    progressTotal: 5636,
    errorCode: 'MARKETPLACE_UNREACHABLE',
    errorMessage: 'Marketplace unreachable (500) — upstream issue',
    attemptCount: 2,
    nextAttemptAt: '2026-04-28T10:05:00.000Z',
    ...overrides,
  };
}

describe('SyncCenter — FAILED_RETRYABLE rendering', () => {
  it('renders a FAILED_RETRYABLE row inside the "Yeniden deneniyor" section', () => {
    renderCenter({ logs: [makeRetryableLog()] });

    // The retry section heading must be present. ("Yeniden deneniyor"
    // is also the status-badge label, so disambiguate by heading role.)
    expect(screen.getByRole('heading', { name: 'Yeniden deneniyor' })).toBeInTheDocument();

    // The row MUST NOT live in the "Geçmiş" (Recent) section — and
    // since the retry section was rendered, the "Geçmiş" header must
    // be absent (no terminal rows seeded).
    expect(screen.queryByRole('heading', { name: 'Geçmiş' })).not.toBeInTheDocument();
  });

  it('renders the localized error title + description, never the raw enum or English detail', () => {
    // The fixture seeds `errorCode: 'MARKETPLACE_UNREACHABLE'` and
    // `errorMessage: 'Marketplace unreachable (500) — upstream issue'`.
    // The retry banner MUST translate the enum to user-facing copy and
    // MUST NOT leak either the enum identifier or the RFC 7807 `detail`
    // string (which is dev-facing log diagnostic, not user copy).
    renderCenter({ logs: [makeRetryableLog()] });

    expect(screen.getByText('Pazar yerine ulaşılamıyor')).toBeInTheDocument();
    expect(
      screen.getByText('Pazar yerinin sunucuları geçici olarak yanıt vermiyor.'),
    ).toBeInTheDocument();

    expect(screen.queryByText('MARKETPLACE_UNREACHABLE')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Marketplace unreachable \(500\) — upstream issue/),
    ).not.toBeInTheDocument();
  });

  it('falls back to localized "unknown error" copy when the errorCode is not in the known list', () => {
    // Defends against a freshly-shipped backend code that doesn't have a
    // translation yet — the user must never see the raw enum identifier.
    renderCenter({
      logs: [makeRetryableLog({ errorCode: 'BRAND_NEW_UNKNOWN_CODE' })],
    });

    expect(screen.getByText('Bilinmeyen hata')).toBeInTheDocument();
    expect(screen.queryByText('BRAND_NEW_UNKNOWN_CODE')).not.toBeInTheDocument();
  });

  it('shows the "Yeniden denenecek" countdown with the formatted time', () => {
    renderCenter({ logs: [makeRetryableLog()] });
    // The hydration gate (useIsMounted) renders the absolute time on
    // first paint and swaps to relative once mounted. Either path is
    // valid — we only assert the prefix copy made it through with a
    // substitution.
    expect(screen.getByText(/Yeniden denenecek/)).toBeInTheDocument();
  });

  it('shows the "Deneme N" attempt count', () => {
    renderCenter({ logs: [makeRetryableLog({ attemptCount: 2 })] });
    expect(screen.getByText(/Deneme 2/)).toBeInTheDocument();
  });

  it('disables the manual retrigger while a FAILED_RETRYABLE row exists for that syncType', () => {
    // The partial unique index slot is occupied by the retryable row;
    // a manual POST /products/sync would 409 SYNC_IN_PROGRESS. The
    // button MUST be disabled to prevent the user from triggering one.
    renderCenter({ logs: [makeRetryableLog()] });
    const button = screen.getByRole('button', { name: 'Ürünleri şimdi senkronize et' });
    expect(button).toBeDisabled();
  });

  it('keeps the manual retrigger enabled when only terminal rows exist', () => {
    // Sanity check: terminal COMPLETED in the cache must NOT lock the
    // trigger. Only PENDING / RUNNING / FAILED_RETRYABLE rows occupy
    // the active-slot index.
    const completed: SyncCenterLog = {
      ...makeRetryableLog({ id: 'log-done' }),
      status: 'COMPLETED',
      errorCode: null,
      errorMessage: null,
      attemptCount: 1,
      nextAttemptAt: null,
      completedAt: '2026-04-28T09:00:00.000Z',
      recordsProcessed: 5636,
    };
    renderCenter({ logs: [completed] });
    const button = screen.getByRole('button', { name: 'Ürünleri şimdi senkronize et' });
    expect(button).toBeEnabled();
  });
});

describe('SyncCenter — completed-with-skipped-pages chip', () => {
  function makeCompletedWithSkippedLog(skipCount: number): SyncCenterLog {
    return {
      ...makeRetryableLog({ id: 'log-done-with-skips' }),
      status: 'COMPLETED',
      errorCode: null,
      errorMessage: null,
      attemptCount: 1,
      nextAttemptAt: null,
      completedAt: '2026-04-28T09:00:00.000Z',
      recordsProcessed: 5524,
      skippedPages: Array.from({ length: skipCount }, (_, i) => ({
        page: 25 + i,
        attemptedAt: '2026-04-28T09:00:00.000Z',
        errorCode: 'MARKETPLACE_UNREACHABLE',
        httpStatus: 500,
      })),
    };
  }

  it('renders a "X sayfa atlandı" warning chip on a COMPLETED row that has skippedPages', () => {
    renderCenter({ logs: [makeCompletedWithSkippedLog(1)] });
    expect(screen.getByText('1 sayfa atlandı')).toBeInTheDocument();
    // Detail line with the partial-completion summary, not the clean
    // "n kayıt işlendi" line — communicates that not the entire catalog
    // made it across.
    expect(
      screen.getByText(/5\.524 kayıt işlendi · 1 sayfa Trendyol tarafından sağlanamadı/),
    ).toBeInTheDocument();
  });

  it('counts multiple skipped pages correctly', () => {
    renderCenter({ logs: [makeCompletedWithSkippedLog(3)] });
    expect(screen.getByText('3 sayfa atlandı')).toBeInTheDocument();
  });

  it('does NOT render the chip on a clean COMPLETED row (no skippedPages)', () => {
    const cleanCompleted: SyncCenterLog = {
      ...makeRetryableLog({ id: 'log-clean-done' }),
      status: 'COMPLETED',
      errorCode: null,
      errorMessage: null,
      completedAt: '2026-04-28T09:00:00.000Z',
      recordsProcessed: 5624,
      skippedPages: null,
    };
    renderCenter({ logs: [cleanCompleted] });
    expect(screen.queryByText(/sayfa atlandı/)).not.toBeInTheDocument();
    // Clean summary line still renders.
    expect(screen.getByText(/5\.624 kayıt işlendi/)).toBeInTheDocument();
  });
});

describe('SyncCenter — terminal FAILED row in Recent section', () => {
  function makeFailedLog(overrides: Partial<SyncCenterLog> = {}): SyncCenterLog {
    return {
      id: 'log-failed-1',
      storeId: 'store-1',
      syncType: 'PRODUCTS',
      status: 'FAILED',
      startedAt: '2026-04-28T08:00:00.000Z',
      completedAt: '2026-04-28T08:01:00.000Z',
      recordsProcessed: 0,
      progressCurrent: 0,
      progressTotal: null,
      errorCode: 'MARKETPLACE_AUTH_FAILED',
      errorMessage: 'Trendyol returned 401 — invalid credentials',
      attemptCount: 1,
      nextAttemptAt: null,
      ...overrides,
    };
  }

  it('renders "Hata · <localized title>" — never the raw enum or English errorMessage', () => {
    renderCenter({ logs: [makeFailedLog()] });

    // The list row is intentionally compact — only the title carries
    // the error meaning. Description copy lives on the wider retry
    // banner, not in the recent-syncs list.
    expect(screen.getByText(/Hata · Kimlik doğrulama başarısız/)).toBeInTheDocument();
    expect(screen.queryByText('MARKETPLACE_AUTH_FAILED')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Trendyol returned 401 — invalid credentials/),
    ).not.toBeInTheDocument();
  });

  it('uses the localized fallback when the errorCode is unknown', () => {
    renderCenter({ logs: [makeFailedLog({ errorCode: 'BRAND_NEW_UNKNOWN_CODE' })] });

    expect(screen.getByText(/Hata · Bilinmeyen hata/)).toBeInTheDocument();
    expect(screen.queryByText('BRAND_NEW_UNKNOWN_CODE')).not.toBeInTheDocument();
  });
});
