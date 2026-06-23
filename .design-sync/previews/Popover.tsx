import { Popover, PopoverTrigger, PopoverContent, Button, Currency } from '@pazarsync/web';

export const Open = () => (
  <Popover open>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm">
        Kâr dökümü
      </Button>
    </PopoverTrigger>
    <PopoverContent>
      <div className="gap-sm flex flex-col text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Satış</span>
          <Currency value={199.9} />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Komisyon</span>
          <Currency value={-33.6} />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Kargo</span>
          <Currency value={-23.8} />
        </div>
        <div className="border-border pt-xs flex justify-between border-t font-semibold">
          <span>Net Kâr</span>
          <Currency value={142.5} />
        </div>
      </div>
    </PopoverContent>
  </Popover>
);
