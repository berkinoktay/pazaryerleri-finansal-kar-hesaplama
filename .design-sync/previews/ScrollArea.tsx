import { ScrollArea } from '@pazarsync/web';

export const OrderList = () => (
  <ScrollArea className="border-border max-w-input h-40 w-full rounded-md border">
    <div className="p-md gap-xs flex flex-col text-sm tabular-nums">
      {Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="flex justify-between">
          <span>Sipariş #{11321228951 - i}</span>
          <span className="text-muted-foreground">23.06.2026</span>
        </div>
      ))}
    </div>
  </ScrollArea>
);
