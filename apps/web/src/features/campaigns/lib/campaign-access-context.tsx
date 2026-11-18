'use client';

import * as React from 'react';

import { type CampaignAccess, FULL_CAMPAIGN_ACCESS } from './campaign-access';

/**
 * The default is full access on purpose: the campaign list and detail clients always provide
 * the real value, so only a component rendered on its own (a cell or table test) falls back to
 * it and keeps today's UI. UX only: the backend enforces every permission.
 */
const CampaignAccessContext = React.createContext<CampaignAccess>(FULL_CAMPAIGN_ACCESS);

/**
 * Provides what the current member may do on a campaign page to the whole screen, so tables,
 * toolbars, cells and row menus read it without prop-drilling it through every layer.
 */
export function CampaignAccessProvider({
  value,
  children,
}: {
  value: CampaignAccess;
  children: React.ReactNode;
}): React.ReactElement {
  return <CampaignAccessContext.Provider value={value}>{children}</CampaignAccessContext.Provider>;
}

export function useCampaignAccess(): CampaignAccess {
  return React.useContext(CampaignAccessContext);
}
