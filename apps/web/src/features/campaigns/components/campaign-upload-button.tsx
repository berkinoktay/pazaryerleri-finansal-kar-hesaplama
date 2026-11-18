'use client';

import { CloudUploadIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';

import { UPLOAD_GATES } from '../lib/campaign-access';
import { useCampaignAccess } from '../lib/campaign-access-context';

interface CampaignUploadButtonProps {
  label: string;
  onClick: () => void;
  size?: ButtonProps['size'];
  /**
   * Whether the unsupported-platform sentence is rendered before the disabled button, in one
   * wrapping row (the tab row). Off for a second button on the same screen (the empty state),
   * so the sentence is seen once; that button keeps it for screen readers only.
   */
  withNote?: boolean;
}

/**
 * The workbook upload button of a campaign page, gated by the member's access: hidden for a
 * member who cannot write, disabled with a visible sentence when the store's platform has no
 * workbook format for the page. The sentence is plain text, not a tooltip: a disabled button
 * emits no hover and the reason must be readable on touch. UX only: the backend refuses the
 * upload on its own.
 */
export function CampaignUploadButton({
  label,
  onClick,
  size,
  withNote = true,
}: CampaignUploadButtonProps): React.ReactElement | null {
  const { upload } = useCampaignAccess();
  const tErrors = useTranslations('campaignUpload.errors');
  const noteId = React.useId();

  switch (upload) {
    case UPLOAD_GATES.HIDDEN:
      return null;
    case UPLOAD_GATES.ENABLED:
      return (
        <Button size={size} leadingIcon={<CloudUploadIcon aria-hidden />} onClick={onClick}>
          {label}
        </Button>
      );
    case UPLOAD_GATES.UNSUPPORTED_PLATFORM: {
      const button = (
        <Button
          size={size}
          leadingIcon={<CloudUploadIcon aria-hidden />}
          onClick={onClick}
          disabled
          aria-describedby={noteId}
        >
          {label}
        </Button>
      );
      // Shown once per screen: a second button (the empty state) keeps the reason for screen
      // readers only, so a keyboard or screen reader user reaching it still hears why.
      if (!withNote) {
        return (
          <>
            {button}
            <span id={noteId} className="sr-only">
              {tErrors('unsupportedPlatform')}
            </span>
          </>
        );
      }
      return (
        <div className="gap-xs flex min-w-0 flex-wrap items-center justify-end">
          <p id={noteId} className="text-muted-foreground text-2xs text-right">
            {tErrors('unsupportedPlatform')}
          </p>
          {button}
        </div>
      );
    }
    default: {
      const _exhaustive: never = upload;
      throw new Error(`Unhandled upload gate: ${String(_exhaustive)}`);
    }
  }
}
