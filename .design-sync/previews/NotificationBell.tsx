import { NotificationBell } from '@pazarsync/web';

export const Default = () => (
  <NotificationBell
    unreadCount={3}
    variant="icon"
    entries={[
      { id: '1', icon: 'success', title: 'Hakediş raporu işlendi', timestamp: '2 saat önce' },
      { id: '2', icon: 'warning', title: 'Maliyet bekleyen ürün', timestamp: 'Dün' },
      { id: '3', icon: 'info', title: 'Yeni sipariş senkronlandı', timestamp: '3 gün önce' },
    ]}
  />
);
