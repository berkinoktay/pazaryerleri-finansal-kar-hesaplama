'use client';

import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SIZE_KEYS } from '@/lib/variants';

export default function InputsPrimitivePage(): React.ReactElement {
  const [price, setPrice] = React.useState<number[]>([120]);

  return (
    <>
      <PageHeader
        title="Form alanları"
        intent="Tüm giriş kontrolleri. Label her zaman placeholder'dan önce; aria-invalid hatalı alan için."
      />
      <PrimitiveNav />

      <Preview
        title="Input + Label"
        description="Placeholder label değildir. Tüm giriş alanları Button ile aynı size ailesini (sm/md/lg) paylaşır, formda tutarlı yükseklik."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="email">E-posta</Label>
            <Input id="email" type="email" placeholder="ornek@domain.com" />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="email-bad">Hatalı alan</Label>
            <Input id="email-bad" type="email" defaultValue="bad" aria-invalid />
            <span className="text-2xs text-destructive">Geçerli bir e-posta girin.</span>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="price">Maliyet (₺)</Label>
            <Input id="price" type="number" placeholder="0,00" className="tabular-nums" />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="disabled-input">Salt okunur</Label>
            <Input id="disabled-input" disabled defaultValue="Değiştirilemez" />
          </div>
        </div>
      </Preview>

      <Preview
        title="Textarea"
        description="min-h-20 default, user tarafından yükseklik ayarlanabilir."
      >
        <div className="max-w-form gap-3xs grid">
          <Label htmlFor="notes">Sipariş notu</Label>
          <Textarea id="notes" placeholder="Sipariş hakkında not…" rows={4} />
        </div>
      </Preview>

      <Preview
        title="Input size (paylaşılan prop)"
        description="sm / md (default) / lg. Button ve Select ile aynı anahtar — formda tutarlı yükseklik ailesi."
      >
        <div className="max-w-form gap-md grid">
          {SIZE_KEYS.map((size) => (
            <div key={size} className="gap-3xs flex flex-col">
              <Label className="text-2xs text-muted-foreground font-mono">size = {size}</Label>
              <Input size={size} placeholder="ornek@domain.com" />
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Select"
        description="Radix Select. Klavye + ekran okuyucu dostu. Select item'ına basıldığında popup kapanır."
      >
        <div className="max-w-input-narrow gap-3xs grid">
          <Label>Pazaryeri</Label>
          <Select defaultValue="trendyol">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trendyol">Trendyol</SelectItem>
              <SelectItem value="hepsiburada">Hepsiburada</SelectItem>
              <SelectItem value="n11">n11</SelectItem>
              <SelectItem value="amazon">Amazon</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Preview>

      <Preview title="Checkbox" description="Bağımsız checkbox ve form içinde checkbox.">
        <div className="gap-md flex flex-col">
          <div className="gap-xs flex items-center">
            <Checkbox id="c1" />
            <Label htmlFor="c1">Otomatik senkronizasyon</Label>
          </div>
          <div className="gap-xs flex items-center">
            <Checkbox id="c2" defaultChecked />
            <Label htmlFor="c2">Hata bildirimlerini al</Label>
          </div>
          <div className="gap-xs flex items-center">
            <Checkbox id="c3" disabled />
            <Label htmlFor="c3">Pasif (disabled)</Label>
          </div>
        </div>
      </Preview>

      <Preview
        title="Switch"
        description="Arka planı boolean açık/kapalı için. Checkbox'tan semantik olarak ayrılır."
      >
        <div className="gap-md flex flex-col">
          <div className="gap-xs flex items-center">
            <Switch id="s1" />
            <Label htmlFor="s1">Canlı sipariş feed&apos;i</Label>
          </div>
          <div className="gap-xs flex items-center">
            <Switch id="s2" defaultChecked />
            <Label htmlFor="s2">Haftalık özet e-posta</Label>
          </div>
        </div>
      </Preview>

      <Preview title="RadioGroup" description="Tek bir seçeneğin zorunlu olduğu listeler için.">
        <RadioGroup defaultValue="monthly" className="gap-sm">
          <div className="gap-xs flex items-center">
            <RadioGroupItem value="weekly" id="r1" />
            <Label htmlFor="r1">Haftalık rapor</Label>
          </div>
          <div className="gap-xs flex items-center">
            <RadioGroupItem value="monthly" id="r2" />
            <Label htmlFor="r2">Aylık rapor</Label>
          </div>
          <div className="gap-xs flex items-center">
            <RadioGroupItem value="quarterly" id="r3" />
            <Label htmlFor="r3">Çeyrek dönem</Label>
          </div>
        </RadioGroup>
      </Preview>

      <Preview
        title="Slider"
        description="Fiyat aralığı, komisyon eşiği gibi sürekli değerler için. Değer tabular-nums ile hizalı gösterilir."
      >
        <div className="max-w-input gap-sm grid">
          <div className="flex items-center justify-between text-sm">
            <Label>Net kar hedefi</Label>
            <span className="text-foreground font-mono tabular-nums">₺{price[0]?.toFixed(0)}</span>
          </div>
          <Slider value={price} onValueChange={setPrice} min={0} max={500} step={5} />
        </div>
      </Preview>

      <Preview
        title="InputOTP"
        description="2FA / SMS kodu doğrulama. Tabular-nums, auto-focus ilerleme, Paste desteği."
      >
        <InputOTP maxLength={6}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </Preview>
    </>
  );
}
