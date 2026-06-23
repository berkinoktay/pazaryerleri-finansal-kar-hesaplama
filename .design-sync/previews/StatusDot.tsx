import { StatusDot } from '@pazarsync/web';

export const Tones = () => (
  <div className="gap-sm flex flex-col items-start text-sm">
    <StatusDot tone="success" label="Bağlı" />
    <StatusDot tone="warning" label="Bekliyor" />
    <StatusDot tone="destructive" label="Bağlantı hatası" />
    <StatusDot tone="neutral" label="Pasif" />
  </div>
);

export const Live = () => <StatusDot tone="success" label="Canlı senkronizasyon" animatePulse />;
