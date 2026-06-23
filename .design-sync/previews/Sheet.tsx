import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Button,
  DefinitionList,
  Currency,
} from '@pazarsync/web';

export const Open = () => (
  <Sheet open>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Sipariş #11321228951</SheetTitle>
        <SheetDescription>Trendyol — Ana Mağaza · 23.06.2026</SheetDescription>
      </SheetHeader>
      <div className="px-md">
        <DefinitionList
          dividers
          items={[
            { term: 'Satış', description: <Currency value={199.9} /> },
            { term: 'Komisyon', description: <Currency value={-33.6} /> },
            { term: 'Kargo', description: <Currency value={-23.8} /> },
            { term: 'Net Kâr', description: <Currency value={142.5} emphasis /> },
          ]}
        />
      </div>
      <SheetFooter>
        <Button>Kapat</Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
);
