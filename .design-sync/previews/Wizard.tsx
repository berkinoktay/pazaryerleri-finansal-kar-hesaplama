import { Wizard } from '@pazarsync/web';

const STEPS = [
  {
    id: 'connect',
    label: 'Mağaza',
    content: (
      <div className="text-muted-foreground text-sm">Trendyol API anahtarlarınızı girin.</div>
    ),
  },
  {
    id: 'sync',
    label: 'Senkron',
    content: <div className="text-muted-foreground text-sm">İlk senkronizasyon başlatılıyor…</div>,
  },
  {
    id: 'cost',
    label: 'Maliyet',
    content: <div className="text-muted-foreground text-sm">Ürün maliyetlerini girin.</div>,
  },
];

export const Flow = () => (
  <div className="max-w-modal w-full">
    <Wizard steps={STEPS} current={1} onCurrentChange={() => {}} />
  </div>
);
