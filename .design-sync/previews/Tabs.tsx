import { Tabs, TabsList, TabsTrigger, TabsContent, Currency } from '@pazarsync/web';

export const Panels = () => (
  <Tabs defaultValue="ozet" className="max-w-modal w-full">
    <TabsList>
      <TabsTrigger value="ozet">Özet</TabsTrigger>
      <TabsTrigger value="siparisler">Siparişler</TabsTrigger>
      <TabsTrigger value="iadeler">İadeler</TabsTrigger>
    </TabsList>
    <TabsContent value="ozet">
      <div className="gap-sm pt-md flex flex-col text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ciro</span>
          <Currency value={284390.45} />
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Net Kâr</span>
          <Currency value={68240.1} emphasis />
        </div>
      </div>
    </TabsContent>
  </Tabs>
);
