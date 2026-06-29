'use client';

import { ArrowLeft01Icon, FileUploadIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FileUpload } from '@/components/patterns/file-upload';
import { Button } from '@/components/ui/button';

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;

export interface CommissionTariffsUploadProps {
  /** Called once a file is chosen — creates a saved tariff in the mock page. */
  onFile: (file: File) => void;
  /** When provided, shows a "back to tariffs" link (omitted in the first-run empty state). */
  onBack?: () => void;
}

export function CommissionTariffsUpload({
  onFile,
  onBack,
}: CommissionTariffsUploadProps): React.ReactElement {
  const t = useTranslations('commissionTariffsPage.upload');
  const tTemplates = useTranslations('commissionTariffsPage.templates');
  const [file, setFile] = React.useState<File | null>(null);

  return (
    <div className="gap-lg flex w-full flex-col">
      {onBack !== undefined ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          leadingIcon={<ArrowLeft01Icon aria-hidden />}
          className="self-start"
        >
          {tTemplates('back')}
        </Button>
      ) : null}

      <div className="max-w-form gap-lg py-lg mx-auto flex w-full flex-col">
        <div className="gap-sm flex flex-col items-center text-center">
          <span className="bg-muted text-muted-foreground [&_svg]:size-icon-lg flex size-12 items-center justify-center rounded-xl">
            <FileUploadIcon aria-hidden />
          </span>
          <div className="gap-2xs flex flex-col">
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            <p className="text-muted-foreground text-sm">{t('description')}</p>
          </div>
        </div>

        <FileUpload
          value={file}
          accept=".xlsx"
          prompt={t('prompt')}
          hint={t('hint')}
          ctaLabel={t('cta')}
          onChange={(next) => {
            setFile(next);
            if (next !== null) onFile(next);
          }}
        />

        <div className="border-border gap-sm p-md flex flex-col rounded-lg border">
          <p className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
            {t('stepsTitle')}
          </p>
          <ol className="gap-sm flex flex-col">
            {STEP_KEYS.map((key, index) => (
              <li key={key} className="gap-sm flex items-start">
                <span className="bg-accent text-accent-foreground text-2xs flex size-5 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums">
                  {index + 1}
                </span>
                <span className="text-sm">{t(key)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
