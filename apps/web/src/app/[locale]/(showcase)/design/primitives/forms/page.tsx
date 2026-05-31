'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const connectStoreSchema = z.object({
  name: z.string().min(2, 'Mağaza adı en az 2 karakter olmalı'),
  platform: z.enum(['TRENDYOL', 'HEPSIBURADA', 'N11'], {
    message: 'Pazaryeri seç',
  }),
  apiKey: z.string().min(8, 'API anahtarı en az 8 karakter olmalı'),
  notes: z.string().max(240, 'Not 240 karakteri aşamaz').optional(),
  autoSync: z.boolean(),
});

type ConnectStoreInput = z.infer<typeof connectStoreSchema>;

const statesSchema = z.object({
  sku: z.string().min(3, 'SKU en az 3 karakter olmalı'),
  description: z.string(),
  storeId: z.string(),
});
type StatesInput = z.infer<typeof statesSchema>;

export default function FormsPrimitivePage(): React.ReactElement {
  const form = useForm<ConnectStoreInput>({
    resolver: zodResolver(connectStoreSchema),
    defaultValues: {
      name: '',
      platform: 'TRENDYOL',
      apiKey: '',
      notes: '',
      autoSync: true,
    },
  });

  // Second form whose only field is pre-seeded invalid + validated on mount so
  // the error state is pinned statically (no manual blur needed to QA it).
  const statesForm = useForm<StatesInput>({
    resolver: zodResolver(statesSchema),
    defaultValues: { sku: 'a', description: 'Yalnız açıklamalı alan', storeId: 'str_8f3a91c2' },
  });
  useEffect(() => {
    void statesForm.trigger();
  }, [statesForm]);

  function onSubmit(values: ConnectStoreInput): void {
    toast.success('Form gönderildi (mock)', {
      description: `Mağaza: ${values.name} · ${values.platform}`,
    });
  }

  return (
    <>
      <PageHeader
        title="Form (React Hook Form + Zod)"
        intent="Tüm form ekranlarında aynı kurallar: Zod resolver, FormField wrapper, label+description+error auto-wiring. Feature kodu bu pattern dışına çıkmamalı."
      />
      <PrimitiveNav />

      <Preview
        title="Tam form örneği"
        description="Validation blur'da tetiklenir, error mesajı field altında çıkar, aria-describedby otomatik bağlanır."
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-form gap-md grid">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Mağaza adı</FormLabel>
                  <FormControl>
                    <Input placeholder="Ör. Ana Mağaza" required {...field} />
                  </FormControl>
                  <FormDescription>Panelde mağazayı tanımakta kullanılır.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="platform"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pazaryeri</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seç" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="TRENDYOL">Trendyol</SelectItem>
                      <SelectItem value="HEPSIBURADA">Hepsiburada</SelectItem>
                      <SelectItem value="N11">n11</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API anahtarı</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Min. 8 karakter" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Not (opsiyonel)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Bu mağaza hakkında bir not bırak…" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoSync"
              render={({ field }) => (
                <FormItem direction="row" className="border-border p-sm rounded-md border">
                  <div className="gap-3xs flex flex-col">
                    <FormLabel>Otomatik senkronizasyon</FormLabel>
                    <FormDescription>Yeni siparişleri otomatik olarak al.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="gap-xs flex items-center">
              <Button type="submit">Mağazayı kaydet</Button>
              <Button type="button" variant="ghost" onClick={() => form.reset()}>
                Sıfırla
              </Button>
            </div>
          </form>
        </Form>
      </Preview>

      <Preview
        title="Form — durumlar (hata · zorunlu · devre dışı · gönderiliyor)"
        description="QA için sabitlenmiş durumlar: required (* + aria-required), mount'ta tetiklenen hata (destructive label + role=alert mesaj + shake), açıklamalı-hatasız alan (aria-describedby yalnız açıklamayı içerir, dangling IDREF yok), devre dışı alan ve loading submit."
      >
        <Form {...statesForm}>
          <form
            onSubmit={statesForm.handleSubmit(() => undefined)}
            className="max-w-form gap-md grid"
          >
            <FormField
              control={statesForm.control}
              name="sku"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Stok kodu (SKU)</FormLabel>
                  <FormControl>
                    <Input placeholder="En az 3 karakter" required {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={statesForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Açıklama (hatasız)</FormLabel>
                  <FormControl>
                    <Input readOnly {...field} />
                  </FormControl>
                  <FormDescription>aria-describedby yalnız bu açıklamaya bağlanır.</FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={statesForm.control}
              name="storeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mağaza kimliği (devre dışı)</FormLabel>
                  <FormControl>
                    <Input disabled {...field} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="gap-xs flex items-center">
              <Button type="submit" loading loadingText="Kaydediliyor…">
                Kaydet
              </Button>
            </div>
          </form>
        </Form>
      </Preview>
    </>
  );
}
