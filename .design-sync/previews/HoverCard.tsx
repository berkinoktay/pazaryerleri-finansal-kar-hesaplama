import { HoverCard, HoverCardTrigger, HoverCardContent, Button, Currency } from '@pazarsync/web';

export const Open = () => (
  <HoverCard open>
    <HoverCardTrigger asChild>
      <Button variant="link" size="sm">
        Trendyol — Ana Mağaza
      </Button>
    </HoverCardTrigger>
    <HoverCardContent>
      <div className="gap-xs flex flex-col text-sm">
        <span className="font-semibold">Trendyol — Ana Mağaza</span>
        <span className="text-muted-foreground">Bağlı · son senkron 2 saat önce</span>
        <div className="pt-xs flex justify-between">
          <span className="text-muted-foreground">Bu ay net kâr</span>
          <Currency value={68240.1} emphasis />
        </div>
      </div>
    </HoverCardContent>
  </HoverCard>
);
