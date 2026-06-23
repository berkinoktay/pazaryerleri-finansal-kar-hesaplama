import { Collapsible, CollapsibleTrigger, CollapsibleContent, Button } from '@pazarsync/web';

export const Expanded = () => (
  <Collapsible defaultOpen className="max-w-input w-full">
    <CollapsibleTrigger asChild>
      <Button variant="outline" size="sm">
        Gelişmiş filtreler
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="gap-2xs pt-md text-muted-foreground flex flex-col text-sm">
        <span>Tarih aralığı: Son 30 gün</span>
        <span>Mağaza: Trendyol Ana Mağaza</span>
        <span>Durum: Teslim Edildi</span>
        <span>Maliyet: Girilmiş</span>
      </div>
    </CollapsibleContent>
  </Collapsible>
);
