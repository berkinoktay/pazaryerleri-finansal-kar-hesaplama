import { BottomDock, Button, StatusDot } from '@pazarsync/web';

export const Dock = () => (
  <div className="border-border max-w-input w-full rounded-md border">
    <div className="p-md text-muted-foreground text-sm">Kenar çubuğu içeriği…</div>
    <BottomDock>
      <div className="gap-sm flex items-center justify-between text-sm">
        <StatusDot tone="success" label="Senkron aktif" />
        <Button variant="ghost" size="sm">
          Ayarlar
        </Button>
      </div>
    </BottomDock>
  </div>
);
