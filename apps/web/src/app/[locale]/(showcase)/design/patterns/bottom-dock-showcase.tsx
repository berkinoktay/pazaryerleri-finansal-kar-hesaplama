import { BottomDock } from '@/components/patterns/bottom-dock';
import { Button } from '@/components/ui/button';

export function BottomDockShowcase(): React.ReactElement {
  return (
    <div
      className="border-border bg-card overflow-hidden rounded-md border"
      style={{ width: 240, minHeight: 240 }}
    >
      <div className="text-muted-foreground p-md text-2xs">(sidebar üst kısmı placeholder)</div>
      <BottomDock>
        <Button variant="ghost" size="sm" className="justify-start">
          ❓ Destek
        </Button>
        <Button variant="ghost" size="sm" className="justify-start">
          ⚙ Ayarlar
        </Button>
        <BottomDock.Divider />
        <Button variant="ghost" size="sm" className="justify-start">
          👤 Berkin Oktay
        </Button>
      </BottomDock>
    </div>
  );
}
