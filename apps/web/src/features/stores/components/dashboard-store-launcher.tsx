'use client';

import { useState, type ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';

import { ConnectStoreModal } from './connect-store-modal';

export interface DashboardStoreLauncherProps {
  orgSwitcher: ReactNode;
  activeOrgId: string | undefined;
  children: ReactNode;
}

/**
 * Client wrapper around AppShell that owns the connect-store modal
 * state for the dashboard. The sidebar's ContextRail "+ Mağaza bağla"
 * button fires onAddStore, which opens the shared ConnectStoreModal.
 *
 * This is the single dashboard entry point for connecting a store once
 * the user has an active org — matches the initial design where the
 * sidebar owns cross-feature quick actions (sync, add-store, language).
 */
export function DashboardStoreLauncher({
  orgSwitcher,
  activeOrgId,
  children,
}: DashboardStoreLauncherProps): React.ReactElement {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <AppShell
        orgSwitcher={orgSwitcher}
        onAddStore={activeOrgId !== undefined ? () => setModalOpen(true) : undefined}
      >
        {children}
      </AppShell>
      {activeOrgId !== undefined ? (
        <ConnectStoreModal orgId={activeOrgId} open={modalOpen} onOpenChange={setModalOpen} />
      ) : null}
    </>
  );
}
