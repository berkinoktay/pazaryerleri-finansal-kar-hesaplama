import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncControl } from '@/components/patterns/sync-control';
import {
  SyncSourcesPopover,
  type SyncSourceRowVM,
  type SyncOtherFlowVM,
} from '@/components/patterns/sync-sources-popover';
import { __resetUseNowForTest } from '@/lib/use-now';
import { render, screen, waitFor } from '@/../tests/helpers/render';

// The status trigger carries an explicit aria-label, so it can be looked up
// independently of the dynamic freshness / progress text it wraps.
const STATUS_LABEL = 'Senkron durumu ve kaynak dökümü';

function noop(): void {
  /* intentionally empty */
}

function popoverChild(title = 'Siparişler verisi') {
  return (
    <SyncSourcesPopover
      title={title}
      storeName={null}
      sources={[]}
      others={[]}
      scheduleLabel="Otomatik eşitleme 6 saatte bir"
      onOpenHistory={noop}
    />
  );
}

afterEach(() => {
  __resetUseNowForTest();
});

describe('SyncControl', () => {
  it('renders the status trigger and an enabled sync action in the fresh state', () => {
    render(
      <SyncControl state="fresh" lastSyncedAt="2026-07-01T09:00:00Z" onSync={noop}>
        {popoverChild()}
      </SyncControl>,
    );

    expect(screen.getByRole('button', { name: STATUS_LABEL })).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Eşitle' });
    expect(action).toBeInTheDocument();
    expect(action).toBeEnabled();
    // The never-synced fallback must NOT show when a timestamp is present.
    expect(screen.queryByText('Henüz eşitlenmedi')).not.toBeInTheDocument();
  });

  it('invokes onSync when the action button is clicked', async () => {
    const onSync = vi.fn();
    const { user } = render(
      <SyncControl state="fresh" lastSyncedAt="2026-07-01T09:00:00Z" onSync={onSync}>
        {popoverChild()}
      </SyncControl>,
    );

    await user.click(screen.getByRole('button', { name: 'Eşitle' }));
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('shows progress in the status half and disables the relabeled action while syncing', () => {
    render(
      <SyncControl
        state="syncing"
        lastSyncedAt="2026-07-01T09:00:00Z"
        progress={{ current: 128, total: 210 }}
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    expect(screen.getByRole('button', { name: STATUS_LABEL })).toHaveTextContent('128 / 210 (%61)');
    const action = screen.getByRole('button', { name: 'Eşitleniyor' });
    expect(action).toBeDisabled();
    // Single loading indicator: the spinner lives in the status half only, so
    // the action half carries no spinning ring while syncing.
    expect(action.querySelector('.animate-spin')).toBeNull();
  });

  it('renders the recent label instead of a bare "0 saniye önce" for a just-now timestamp', async () => {
    // now is 10s after the last sync → inside the recent window, so the status
    // half shows the friendly "birkaç saniye önce" phrase, not "0 saniye önce".
    render(
      <SyncControl
        state="fresh"
        lastSyncedAt="2026-07-01T09:00:00Z"
        now={new Date('2026-07-01T09:00:10Z')}
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    expect(await screen.findByText('birkaç saniye önce')).toBeInTheDocument();
  });

  it('shows "Başlatılıyor…" instead of a bare 0 while syncing before the worker reports counts', () => {
    render(
      <SyncControl
        state="syncing"
        lastSyncedAt={null}
        progress={{ current: 0, total: null }}
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    const status = screen.getByRole('button', { name: STATUS_LABEL });
    expect(status).toHaveTextContent('Başlatılıyor…');
    expect(status).not.toHaveTextContent('0 /');
  });

  it('opens the source popover when the status trigger is clicked', async () => {
    const { user } = render(
      <SyncControl state="fresh" lastSyncedAt="2026-07-01T09:00:00Z" onSync={noop}>
        {popoverChild('Siparişler verisi')}
      </SyncControl>,
    );

    await user.click(screen.getByRole('button', { name: STATUS_LABEL }));
    expect(await screen.findByText('Siparişler verisi')).toBeInTheDocument();
  });

  it('omits the action half when hideAction is set', () => {
    render(
      <SyncControl state="fresh" lastSyncedAt="2026-07-01T09:00:00Z" onSync={noop} hideAction>
        {popoverChild()}
      </SyncControl>,
    );

    expect(screen.getByRole('button', { name: STATUS_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eşitle' })).not.toBeInTheDocument();
  });

  it('surfaces the failed label in the status half', () => {
    render(
      <SyncControl state="failed" lastSyncedAt={null} nextAttemptAt={null} onSync={noop}>
        {popoverChild()}
      </SyncControl>,
    );

    expect(screen.getByText('Başarısız')).toBeInTheDocument();
  });

  it('disables the action and surfaces the cooldown copy while a cooldown counts down', async () => {
    render(
      <SyncControl
        state="fresh"
        lastSyncedAt="2026-07-01T09:00:00Z"
        onSync={noop}
        cooldownUntil={Date.now() + 60_000}
      >
        {popoverChild()}
      </SyncControl>,
    );

    // useNow seeds the client "now" during commit (null on SSR / first paint,
    // then a Date), so the live cooldown only reads as active after mount —
    // wait for the disabled state instead of asserting on the first paint.
    const action = screen.getByRole('button', { name: 'Eşitle' });
    await waitFor(() => {
      expect(action).toBeDisabled();
    });
    expect(action.getAttribute('title')).toContain('sn sonra tekrar deneyebilirsiniz');
  });

  it('renders the retry-scheduled label in the status half for the retrying state', () => {
    render(
      <SyncControl
        state="retrying"
        lastSyncedAt={null}
        nextAttemptAt="2026-07-01T09:05:00Z"
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    // The presence of the countdown is enough — asserting exact seconds would be
    // clock-fragile, so we only check the "Yeniden denenecek" prefix renders.
    expect(screen.getByText(/Yeniden denenecek/)).toBeInTheDocument();
  });

  it('renders successLabel instead of the elapsed-time label in the fresh state', () => {
    const { container } = render(
      <SyncControl
        state="fresh"
        lastSyncedAt="2026-07-01T09:00:00Z"
        now={new Date('2026-07-01T09:00:10Z')}
        successLabel="Tüm siparişleriniz güncellendi"
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    // The transient confirmation replaces the freshness label entirely — no
    // relative "birkaç saniye önce" text and no <time> element are rendered.
    expect(screen.getByText('Tüm siparişleriniz güncellendi')).toBeInTheDocument();
    expect(screen.queryByText('birkaç saniye önce')).not.toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
  });

  it('ignores successLabel in the failed state — an error outranks the confirmation', () => {
    render(
      <SyncControl
        state="failed"
        lastSyncedAt={null}
        nextAttemptAt={null}
        successLabel="Tüm siparişleriniz güncellendi"
        onSync={noop}
      >
        {popoverChild()}
      </SyncControl>,
    );

    expect(screen.queryByText('Tüm siparişleriniz güncellendi')).not.toBeInTheDocument();
    expect(screen.getByText('Başarısız')).toBeInTheDocument();
  });
});

describe('SyncSourcesPopover', () => {
  const primaryRow: SyncSourceRowVM = {
    syncType: 'ORDERS',
    state: 'fresh',
    lastSyncedAt: '2026-07-01T09:00:00Z',
    progress: null,
    nextAttemptAt: null,
    errorLabel: null,
  };

  const otherFlow: SyncOtherFlowVM = {
    storeName: null,
    domainLabel: 'Ürün bilgileri',
    status: 'active',
    progress: { current: 5, total: 10 },
  };

  function renderPopover(overrides: Partial<React.ComponentProps<typeof SyncSourcesPopover>> = {}) {
    return render(
      <SyncSourcesPopover
        title="Siparişler verisi"
        storeName="Mağazam"
        sources={[primaryRow]}
        others={[]}
        scheduleLabel="Otomatik eşitleme 6 saatte bir"
        onOpenHistory={noop}
        {...overrides}
      />,
    );
  }

  it('renders the source as a friendly domain sentence, without the old primary tag or retry icon', () => {
    renderPopover();
    // Friendly domain label replaces the old "Sipariş senkronu" + "Birincil" tag.
    expect(screen.getByText('Sipariş bilgileri')).toBeInTheDocument();
    expect(screen.queryByText('Birincil')).not.toBeInTheDocument();
    // The row-level re-sync icon button is gone (only the full-history link remains).
    expect(screen.queryByRole('button', { name: /yeniden eşitle/i })).not.toBeInTheDocument();
  });

  it('hides the others section when there are no other flows', () => {
    renderPopover({ others: [] });
    expect(screen.queryByText(/Panelin geri kalanı/)).not.toBeInTheDocument();
  });

  it('shows the others section when other flows exist', () => {
    renderPopover({ others: [otherFlow] });
    expect(screen.getByText(/Panelin geri kalanı/)).toBeInTheDocument();
  });

  it('invokes onOpenHistory when the full-history link is clicked', async () => {
    const onOpenHistory = vi.fn();
    const { user } = renderPopover({ onOpenHistory });

    await user.click(screen.getByRole('button', { name: /Tüm geçmiş/ }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });
});
