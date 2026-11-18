import type { Platform } from '@pazarsync/db/enums';
import { hasWorkbookFormat, type WorkbookPage } from '@pazarsync/utils';

/** How a campaign page offers its workbook upload button. */
export const UPLOAD_GATES = {
  /** The member cannot write: no upload button at all. */
  HIDDEN: 'hidden',
  /** The member can write but the store's platform has no workbook format for the page. */
  UNSUPPORTED_PLATFORM: 'unsupportedPlatform',
  /** The upload works as usual. */
  ENABLED: 'enabled',
} as const;

export type WorkbookUploadGate = (typeof UPLOAD_GATES)[keyof typeof UPLOAD_GATES];

/**
 * What a campaign page lets the current member do. UX only: the backend enforces every
 * permission and refuses an unsupported platform on its own.
 */
export interface CampaignAccess {
  /** Whether controls that start a write (select, save, delete, export, edit) are offered. */
  readonly canWrite: boolean;
  readonly upload: WorkbookUploadGate;
}

/** A writer on a store whose platform has a workbook format: today's full UI. */
export const FULL_CAMPAIGN_ACCESS: CampaignAccess = {
  canWrite: true,
  upload: UPLOAD_GATES.ENABLED,
};

const READ_ONLY_CAMPAIGN_ACCESS: CampaignAccess = {
  canWrite: false,
  upload: UPLOAD_GATES.HIDDEN,
};

const UNSUPPORTED_PLATFORM_CAMPAIGN_ACCESS: CampaignAccess = {
  canWrite: true,
  upload: UPLOAD_GATES.UNSUPPORTED_PLATFORM,
};

export interface ResolveCampaignAccessInput {
  canWrite: boolean;
  /** The platform of the store in scope; `null` when no store is selected. */
  platform: Platform | null;
  page: WorkbookPage;
}

/**
 * Resolves the access of one campaign page. The order matters: the write check comes first,
 * so a member who cannot write never sees the unsupported platform message, only the
 * read-only notice. No store in scope counts as supported (the list client shows its own
 * "select a store" state then).
 */
export function resolveCampaignAccess({
  canWrite,
  platform,
  page,
}: ResolveCampaignAccessInput): CampaignAccess {
  if (!canWrite) return READ_ONLY_CAMPAIGN_ACCESS;
  if (platform !== null && !hasWorkbookFormat(page, platform)) {
    return UNSUPPORTED_PLATFORM_CAMPAIGN_ACCESS;
  }
  return FULL_CAMPAIGN_ACCESS;
}
