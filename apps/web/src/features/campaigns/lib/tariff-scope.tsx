'use client';

import * as React from 'react';

/** The org / store / tariff ids every detail-screen data hook needs. */
export interface TariffScope {
  orgId: string;
  storeId: string;
  tariffId: string;
}

const TariffScopeContext = React.createContext<TariffScope | null>(null);

/**
 * Provides the current tariff's scope to the detail subtree so the deeply-nested
 * band + custom-price cells can call the estimate hook without prop-drilling
 * org/store/tariff through the table (CLAUDE.md: context at the boundary).
 */
export function TariffScopeProvider({
  scope,
  children,
}: {
  scope: TariffScope;
  children: React.ReactNode;
}): React.ReactElement {
  return <TariffScopeContext.Provider value={scope}>{children}</TariffScopeContext.Provider>;
}

export function useTariffScope(): TariffScope {
  const scope = React.useContext(TariffScopeContext);
  if (scope === null) {
    throw new Error('useTariffScope must be used within a TariffScopeProvider');
  }
  return scope;
}
