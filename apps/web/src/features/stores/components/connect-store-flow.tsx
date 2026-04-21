'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { ConnectStoreForm } from './connect-store-form';

export interface ConnectStoreFlowProps {
  orgId: string;
  /** Where to navigate after a successful connect. */
  redirectOnSuccess: string;
}

/**
 * Client wrapper around ConnectStoreForm for the onboarding page. The
 * page itself is an RSC; this client component owns the success toast
 * + router.push transition and the "skip" link (which is a plain
 * anchor, not a button, so it works with JS disabled).
 */
export function ConnectStoreFlow({
  orgId,
  redirectOnSuccess,
}: ConnectStoreFlowProps): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('stores.connect');

  return (
    <div className="gap-md flex flex-col">
      <ConnectStoreForm
        orgId={orgId}
        autoFocus
        onSuccess={(store) => {
          toast.success(t('title'), { description: store.name });
          router.push(redirectOnSuccess);
          router.refresh();
        }}
      />
      <div className="flex justify-center">
        <Link
          href={redirectOnSuccess}
          className="text-muted-foreground hover:text-foreground text-sm underline"
        >
          {t('actions.skip')}
        </Link>
      </div>
    </div>
  );
}
