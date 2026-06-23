import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@pazarsync/web';

export const Faq = () => (
  <Accordion type="single" collapsible defaultValue="item-1" className="max-w-modal w-full">
    <AccordionItem value="item-1">
      <AccordionTrigger>Net kâr nasıl hesaplanır?</AccordionTrigger>
      <AccordionContent>
        Satış tutarından komisyon, kargo, hizmet bedeli, KDV ve stopaj düşülerek hesaplanır.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-2">
      <AccordionTrigger>Maliyet ne zaman girilmeli?</AccordionTrigger>
      <AccordionContent>
        Sipariş geldikten sonra maliyet penceresi içinde; aksi halde sipariş kâr hesabı dışına
        alınır.
      </AccordionContent>
    </AccordionItem>
    <AccordionItem value="item-3">
      <AccordionTrigger>Hakediş mutabakatı nedir?</AccordionTrigger>
      <AccordionContent>
        Trendyol hakediş faturasıyla tahmini değerleri karşılaştırıp gerçek değerleri yansıtmaktır.
      </AccordionContent>
    </AccordionItem>
  </Accordion>
);
