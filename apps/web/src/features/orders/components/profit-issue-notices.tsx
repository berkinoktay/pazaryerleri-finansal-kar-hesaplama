'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { components } from '@pazarsync/api-client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export type ProfitIssueWire = components['schemas']['ProfitIssue'];

/** The non-blocking profit issue codes the order detail surfaces as notices. */
const NOTICE_CODES = ['CARRIER_NOT_RECOGNIZED', 'SELLER_CARGO_AGREEMENT_ESTIMATE'] as const;

type NoticeCode = (typeof NOTICE_CODES)[number];

type NoticeIssue = ProfitIssueWire & { code: NoticeCode };

function isNoticeIssue(issue: ProfitIssueWire): issue is NoticeIssue {
  return NOTICE_CODES.some((code) => code === issue.code);
}

export interface ProfitIssueNoticesProps {
  issues: ProfitIssueWire[];
}

/**
 * Warning notices for the best-known profit statement's visible issues. Only the
 * codes in NOTICE_CODES render (one alert per issue, stacked); every other code is
 * filtered out, and nothing renders when none remain. The provider name comes from
 * the issue detail, falling back to a generic carrier label.
 */
export function ProfitIssueNotices({ issues }: ProfitIssueNoticesProps): React.ReactElement | null {
  const t = useTranslations('orderDetail');

  const notices = issues.filter(isNoticeIssue);
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="gap-lg flex flex-col">
      {notices.map((issue, index) => {
        const providerName = issue.detail ?? t('profitIssues.unknownCarrier');
        return (
          <Alert key={`${issue.code}-${index}`} tone="warning" size="md">
            <AlertTitle>{t(`profitIssues.${issue.code}.title`)}</AlertTitle>
            <AlertDescription>
              {t(`profitIssues.${issue.code}.description`, { providerName })}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
