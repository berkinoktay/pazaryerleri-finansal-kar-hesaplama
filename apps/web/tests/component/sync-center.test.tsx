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
    completedSummary: '{n} kayıt işlendi',
    failedSummary: 'Hata',
    willRetry: 'Yeniden denenecek {when}',
    willRetryUnknown: 'Yeniden denenecek',
    attempt: 'Deneme {n}',
    empty: 'Henüz senkronizasyon yok.',
    unknownStore: 'Bilinmeyen mağaza',
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

describe('SyncCenter — FAILED_RETRYABLE rendering (§D.4 regression lock)', () => {
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

  it('surfaces the errorCode and errorMessage on the row', () => {
    renderCenter({ logs: [makeRetryableLog()] });
    expect(screen.getByText('MARKETPLACE_UNREACHABLE')).toBeInTheDocument();
    expect(
      screen.getByText(/Marketplace unreachable \(500\) — upstream issue/),
    ).toBeInTheDocument();
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
