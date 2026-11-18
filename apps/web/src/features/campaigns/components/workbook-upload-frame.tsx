'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  WORKBOOK_UPLOAD_MAX_BYTES,
  WORKBOOK_UPLOAD_MAX_MB,
  type WorkbookPage,
} from '@pazarsync/utils';

import { FileUpload } from '@/components/patterns/file-upload';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { useWorkbookErrorMessage } from '../hooks/use-workbook-error-message';
import { WORKBOOK_VERTICALS, type AppMessageKey } from '../lib/workbook-verticals';
import { UploadUnplacedIssues } from './upload-unplaced-issues';

/** The page's own sentences of the upload dialog, as full message key paths. */
interface UploadDialogTexts {
  readonly title: AppMessageKey;
  readonly description: AppMessageKey;
  readonly submit: AppMessageKey;
}

/** The three-step guide of a page that shows one. */
interface UploadStepTexts {
  readonly title: AppMessageKey;
  readonly steps: readonly [AppMessageKey, AppMessageKey, AppMessageKey];
}

/**
 * Written out as typed full key paths (never a namespace picked from the page), so removing a
 * message any page still shows fails typecheck.
 */
const UPLOAD_DIALOG_TEXTS: Readonly<Record<WorkbookPage, UploadDialogTexts>> = {
  COMMISSION_TARIFF: {
    title: 'commissionTariffsPage.upload.title',
    description: 'commissionTariffsPage.upload.description',
    submit: 'commissionTariffsPage.upload.submit',
  },
  PLUS_COMMISSION_TARIFF: {
    title: 'plusCommissionTariffsPage.upload.title',
    description: 'plusCommissionTariffsPage.upload.description',
    submit: 'plusCommissionTariffsPage.upload.submit',
  },
  ADVANTAGE_TARIFF: {
    title: 'productLabelsPage.upload.title',
    description: 'productLabelsPage.upload.description',
    submit: 'productLabelsPage.upload.submit',
  },
  FLASH_PRODUCT_LIST: {
    title: 'flashProductsPage.upload.title',
    description: 'flashProductsPage.upload.description',
    submit: 'flashProductsPage.upload.submit',
  },
  DISCOUNT_LIST: {
    title: 'discountsPage.upload.title',
    description: 'discountsPage.upload.description',
    submit: 'discountsPage.upload.submit',
  },
  MARKETPLACE_CAMPAIGN_LIST: {
    title: 'marketplaceCampaignsPage.upload.title',
    description: 'marketplaceCampaignsPage.upload.description',
    submit: 'marketplaceCampaignsPage.upload.submit',
  },
};

/**
 * The guide of each page: null for a page that shows none. The one source of whether a page
 * shows the guide; every page has an entry, so a new page must decide it.
 */
const UPLOAD_STEP_TEXTS: Readonly<Record<WorkbookPage, UploadStepTexts | null>> = {
  COMMISSION_TARIFF: {
    title: 'commissionTariffsPage.upload.stepsTitle',
    steps: [
      'commissionTariffsPage.upload.step1',
      'commissionTariffsPage.upload.step2',
      'commissionTariffsPage.upload.step3',
    ],
  },
  PLUS_COMMISSION_TARIFF: {
    title: 'plusCommissionTariffsPage.upload.stepsTitle',
    steps: [
      'plusCommissionTariffsPage.upload.step1',
      'plusCommissionTariffsPage.upload.step2',
      'plusCommissionTariffsPage.upload.step3',
    ],
  },
  ADVANTAGE_TARIFF: {
    title: 'productLabelsPage.upload.stepsTitle',
    steps: [
      'productLabelsPage.upload.step1',
      'productLabelsPage.upload.step2',
      'productLabelsPage.upload.step3',
    ],
  },
  FLASH_PRODUCT_LIST: {
    title: 'flashProductsPage.upload.stepsTitle',
    steps: [
      'flashProductsPage.upload.step1',
      'flashProductsPage.upload.step2',
      'flashProductsPage.upload.step3',
    ],
  },
  DISCOUNT_LIST: null,
  MARKETPLACE_CAMPAIGN_LIST: null,
};

/**
 * The classes of a dialog whose page caps its height (its `modalClassName`, see
 * `components.css`): the header and the footer stay fixed and the body scrolls between them.
 * A page without one keeps the dialog's own layout.
 */
const CAPPED_DIALOG = {
  content: 'flex flex-col overflow-hidden',
  header: 'shrink-0',
  form: 'min-h-0 flex-1',
  body: 'min-h-0 flex-1 overflow-y-auto',
  footer: 'shrink-0',
} as const;

export interface WorkbookUploadFrameProps {
  page: WorkbookPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * True while the import request is in flight: drives the submit button, and locks the file,
   * the cancel button and every close request until the import answers.
   */
  submitting?: boolean;
  /**
   * The import mutation's error: its file refusal is shown on the dropzone, and its field
   * issues on anything not in `placedFields` are listed under it.
   */
  submitError?: Error | null;
  /** Clears the last import error (a new file is picked, or the dialog closes). */
  onResetError?: () => void;
  /** The fields that have a message slot on screen right now, the file included. */
  placedFields: readonly string[];
  /** Whether the page's own fields allow a submit (the file is checked here). */
  extrasReady: boolean;
  /** Fires on submit with the picked file; the page's own fields are the caller's. */
  onSubmitFile: (file: File) => void;
  /** Fires when the dialog closes, so the caller resets the state of its own fields. */
  onClosed: () => void;
  /** The page's own fields, under the dropzone (or beside it on a two-column page). */
  children?: React.ReactNode;
}

/**
 * The chrome every workbook upload dialog shares: the page's title and description, the
 * dropzone with the shared texts, the file refusal and the field issues no input owns, the
 * page's step guide, the page's own fields, and the footer. The frame holds the file; the page's
 * fields hold their own state and report readiness through `extrasReady`. The body is a real
 * form, so Enter in a text field submits (and never cancels).
 */
export function WorkbookUploadFrame({
  page,
  open,
  onOpenChange,
  submitting = false,
  submitError,
  onResetError,
  placedFields,
  extrasReady,
  onSubmitFile,
  onClosed,
  children,
}: WorkbookUploadFrameProps): React.ReactElement {
  const t = useTranslations();
  const tUpload = useTranslations('campaignUpload');
  const tCommon = useTranslations('common');
  const fileErrorMessage = useWorkbookErrorMessage(page);
  const [file, setFile] = React.useState<File | null>(null);

  const vertical = WORKBOOK_VERTICALS[page];
  const texts = UPLOAD_DIALOG_TEXTS[page];
  const stepTexts = UPLOAD_STEP_TEXTS[page];
  const capped = vertical.modalClassName !== undefined;

  const handleOpenChange = (next: boolean): void => {
    // A close request (Escape, the overlay, the close control) waits for the import: closing
    // resets the mutation, which drops the success callback that routes to the new record.
    if (!next && submitting) return;
    // Reset the whole form when the dialog closes, so reopening starts clean. The error reset
    // runs first, so whatever a form records while its error goes away is then cleared by
    // `onClosed` and never outlives the close.
    if (!next) {
      setFile(null);
      onResetError?.();
      onClosed();
    }
    onOpenChange(next);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (file === null || !extrasReady) return;
    onSubmitFile(file);
  };

  const fileBlock = (
    <div className="gap-md flex flex-col">
      <FileUpload
        value={file}
        accept=".xlsx"
        maxSize={WORKBOOK_UPLOAD_MAX_BYTES}
        prompt={tUpload('prompt')}
        hint={tUpload('hint', { maxMb: WORKBOOK_UPLOAD_MAX_MB })}
        ctaLabel={tUpload('cta')}
        errorWrongType={tUpload('fileErrors.wrongType')}
        errorTooLarge={tUpload('fileErrors.tooLarge', { maxMb: WORKBOOK_UPLOAD_MAX_MB })}
        removeLabel={tUpload('removeFile')}
        error={fileErrorMessage(submitError)}
        // Locked while the import is in flight: a new or removed file resets the mutation.
        disabled={submitting}
        onChange={(next) => {
          setFile(next);
          onResetError?.();
        }}
      />
      <UploadUnplacedIssues error={submitError} placedFields={placedFields} />

      {stepTexts !== null ? (
        <div className="border-border bg-surface-subtle gap-sm p-md flex flex-col rounded-lg border">
          <p className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            {t(stepTexts.title)}
          </p>
          <ol className="gap-sm flex flex-col">
            {stepTexts.steps.map((key, index) => (
              <li key={key} className="gap-sm flex items-start">
                <span className="bg-primary-soft text-primary-soft-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="text-sm">{t(key)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );

  // A two-column page puts its own fields beside the file (one column below `md`).
  const body =
    vertical.layout === 'split' ? (
      <div className="gap-lg grid md:grid-cols-2">
        {fileBlock}
        {children}
      </div>
    ) : (
      <div className="gap-md flex flex-col">
        {fileBlock}
        {children}
      </div>
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn(vertical.modalClassName, capped && CAPPED_DIALOG.content)}>
        <DialogHeader className={cn(capped && CAPPED_DIALOG.header)}>
          <DialogTitle>{t(texts.title)}</DialogTitle>
          <DialogDescription>{t(texts.description)}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit}
          className={cn('gap-md flex flex-col', capped && CAPPED_DIALOG.form)}
        >
          {capped ? <div className={CAPPED_DIALOG.body}>{body}</div> : body}

          <DialogFooter className={cn(capped && CAPPED_DIALOG.footer)}>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={file === null || !extrasReady} loading={submitting}>
              {t(texts.submit)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
