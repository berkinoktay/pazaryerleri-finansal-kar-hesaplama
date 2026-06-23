import { ActivityFeed } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <ActivityFeed
      entries={[
        {
          id: '1',
          title: 'Hakediş raporu işlendi',
          description: 'Trendyol Mayıs hakediş raporu — 142 siparişin net kârı güncellendi.',
          timestamp: '2 saat önce',
          tone: 'success',
        },
        {
          id: '2',
          title: 'Yeni sipariş senkronlandı',
          description: 'Trendyol — 11321228951',
          timestamp: '5 saat önce',
          tone: 'info',
        },
        {
          id: '3',
          title: 'Maliyet bekleyen ürün',
          description: '3 ürün kâr hesabı dışında tutuluyor.',
          timestamp: 'Dün',
          tone: 'warning',
        },
      ]}
    />
  </div>
);
