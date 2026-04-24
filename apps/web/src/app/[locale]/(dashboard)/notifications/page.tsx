import type { Metadata } from 'next';

import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';

export const metadata: Metadata = {
  title: 'Bildirimler',
};

export default function NotificationsPage(): React.ReactElement {
  return (
    <>
      <PageHeader title="Bildirimler" intent="Sistemden gelen tüm bildirimlerin geçmişi." />
      <EmptyState
        title="Bildirim merkezi yakında"
        description="Senkronizasyon olayları, yeni sipariş bildirimleri ve uyarı geçmişi burada listelenecek."
      />
    </>
  );
}
