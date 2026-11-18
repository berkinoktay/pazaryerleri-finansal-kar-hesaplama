'use client';

import { CloudUploadIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { UPLOAD_GATES } from '../lib/campaign-access';
import { useCampaignAccess } from '../lib/campaign-access-context';

type CampaignUploadButtonLayout = 'inline' | 'stacked';

interface CampaignUploadButtonProps {
  label: string;
  onClick: () => void;
  size?: ButtonProps['size'];
  /** `inline`: sentence then button in a wrapping row (tab row). `stacked`: button above a centered sentence. */
  layout?: CampaignUploadButtonLayout;
  /** Whether the unsupported-platform sentence is rendered next to the disabled button. */
  withNote?: boolean;
}

const WRAPPER_CLASS: Record<CampaignUploadButtonLayout, string> = {
  inline: 'gap-xs flex min-w-0 flex-wrap items-center justify-end',
  stacked: 'gap-xs flex flex-col items-center',
};

const NOTE_CLASS: Record<CampaignUploadButtonLayout, string> = {
  inline: 'text-right',
  stacked: 'max-w-prose-max text-center',
};

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
  layout = 'inline',
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
          aria-describedby={withNote ? noteId : undefined}
        >
          {label}
        </Button>
      );
      if (!withNote) return button;
      const note = (
        <p id={noteId} className={cn('text-muted-foreground text-2xs', NOTE_CLASS[layout])}>
          {tErrors('unsupportedPlatform')}
        </p>
      );
      return (
        <div className={WRAPPER_CLASS[layout]}>
          {layout === 'inline' ? (
            <>
              {note}
              {button}
            </>
          ) : (
            <>
              {button}
              {note}
            </>
          )}
        </div>
      );
    }
    default: {
      const _exhaustive: never = upload;
      throw new Error(`Unhandled upload gate: ${String(_exhaustive)}`);
    }
  }
}
