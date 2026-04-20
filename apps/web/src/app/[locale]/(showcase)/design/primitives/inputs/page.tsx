'use client';

import {
  Building03Icon,
  Calendar01Icon,
  Mail01Icon,
  Search01Icon,
  UserIcon,
  ViewIcon,
  ViewOffIcon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { PrimitiveNav } from '@/components/showcase/primitive-nav';
import { Preview } from '@/components/showcase/preview';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
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
  const t = useTranslations('common');
  const [price, setPrice] = React.useState<number[]>([120]);
  const [query, setQuery] = React.useState('sipariş');
  const [passwordVisible, setPasswordVisible] = React.useState(false);

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
        title="Leading / trailing icon"
        description="Ikon slot'ları otomatik size-icon-sm, muted renk, padding otomatik ayarlanır. Her viewport ve theme'de tutarlı."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="search-leading">Arama (leadingIcon)</Label>
            <Input
              id="search-leading"
              leadingIcon={<Search01Icon />}
              placeholder="Sipariş, müşteri, SKU…"
            />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="email-leading">E-posta (leadingIcon + trailingIcon)</Label>
            <Input
              id="email-leading"
              type="email"
              leadingIcon={<Mail01Icon />}
              trailingIcon={<Calendar01Icon />}
              placeholder="ornek@domain.com"
            />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="user-leading">Kullanıcı (icon + invalid)</Label>
            <Input id="user-leading" leadingIcon={<UserIcon />} invalid defaultValue="!!" />
            <span className="text-2xs text-destructive">En az 2 harf içermeli.</span>
          </div>
        </div>
      </Preview>

      <Preview
        title="Clearable (onClear)"
        description="Value doluyken sağda X butonu çıkar. Klavye erişilebilir, aria-label i18n'den geliyor, pointer-coarse altında dokunma alanı genişler."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="q-clear">Sipariş ara (controlled)</Label>
            <Input
              id="q-clear"
              leadingIcon={<Search01Icon />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              clearLabel={t('clear')}
              placeholder="Sipariş numarası…"
            />
            <span className="text-2xs text-muted-foreground">Değer: &quot;{query}&quot;</span>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="q-clear-uc">Uncontrolled</Label>
            <Input
              id="q-clear-uc"
              leadingIcon={<Search01Icon />}
              defaultValue="demo"
              onClear={() => undefined}
              clearLabel={t('clear')}
            />
          </div>
        </div>
      </Preview>

      <Preview
        title="Loading"
        description="aria-busy=true + spinner. Input yine yazılabilir (async autocomplete için). prefers-reduced-motion altında dönmez."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="q-loading">Async sonuç</Label>
            <Input
              id="q-loading"
              leadingIcon={<Search01Icon />}
              loading
              loadingLabel={t('loading')}
              defaultValue="Trendyol"
            />
          </div>
        </div>
      </Preview>

      <Preview
        title="Free-form leading / trailing"
        description="Icon yerine metin, kbd ipucu, birim — her şey geçer. leadingIcon/trailingIcon ile aynı slotlar, ama içerik olduğu gibi render edilir (auto-color yok)."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="price-unit">Ürün maliyeti</Label>
            <Input
              id="price-unit"
              type="number"
              leading={<span className="text-muted-foreground text-sm">₺</span>}
              trailing={<span className="text-muted-foreground text-2xs">KDV hariç</span>}
              placeholder="0,00"
              className="tabular-nums"
            />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="cmd-search">Komut paleti ara</Label>
            <Input
              id="cmd-search"
              leadingIcon={<Search01Icon />}
              trailing={<Kbd>⌘K</Kbd>}
              placeholder="Yaz, ara, hızla git…"
            />
          </div>
        </div>
      </Preview>

      <Preview
        title="Interactive trailing (password toggle)"
        description="Trailing slot'a buton geçirilebilir. Etkileşim kullanıcıya bırakıldığı için slot içeriği kendi focus ring'ini ve aria-label'ını kendi yönetir."
      >
        <div className="max-w-form gap-3xs flex flex-col">
          <Label htmlFor="pw">Parola</Label>
          <Input
            id="pw"
            type={passwordVisible ? 'text' : 'password'}
            placeholder="En az 8 karakter"
            trailing={
              <button
                type="button"
                aria-label={passwordVisible ? 'Parolayı gizle' : 'Parolayı göster'}
                onClick={() => setPasswordVisible((v) => !v)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring p-3xs duration-fast [&_svg]:size-icon-sm cursor-pointer rounded-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {passwordVisible ? <ViewOffIcon /> : <ViewIcon />}
              </button>
            }
          />
        </div>
      </Preview>

      <Preview
        title="Sizes with adornments"
        description="sm / md / lg — ikon boyutu sabit (size-icon-sm), padding boyuta göre; rhythm korunur."
      >
        <div className="max-w-form gap-md grid">
          {SIZE_KEYS.map((size) => (
            <div key={size} className="gap-3xs flex flex-col">
              <Label className="text-2xs text-muted-foreground font-mono">size = {size}</Label>
              <Input size={size} leadingIcon={<Search01Icon />} placeholder="Ara…" />
            </div>
          ))}
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
        title="Textarea — counter (maxLength)"
        description="maxLength verildiğinde counter otomatik gösterilir. aria-live=polite ile ekran okuyucular sayımı anons eder."
      >
        <div className="max-w-form gap-3xs grid">
          <Label htmlFor="tw-max">Açıklama (en fazla 120 karakter)</Label>
          <Textarea
            id="tw-max"
            placeholder="Kısa bir özet…"
            rows={3}
            maxLength={120}
            defaultValue="İstanbul - Kadıköy deposundan gönderildi."
          />
        </div>
      </Preview>

      <Preview
        title="Textarea — auto-resize"
        description="İçeriğe göre büyür (grid mirror pattern — height animate edilmez). maxRows ile tavan konur."
      >
        <div className="max-w-form gap-3xs grid">
          <Label htmlFor="tw-auto">Uzun not</Label>
          <Textarea
            id="tw-auto"
            autoResize
            maxRows={8}
            rows={2}
            placeholder="Yazdıkça büyür, 8 satırdan sonra kendi içinde kaydırılır…"
          />
        </div>
      </Preview>

      <Preview
        title="Textarea — invalid"
        description="invalid prop aria-invalid=true + destructive border tokens."
      >
        <div className="max-w-form gap-3xs grid">
          <Label htmlFor="tw-invalid">Kupon kodu</Label>
          <Textarea id="tw-invalid" invalid defaultValue="geçersiz kod" rows={2} />
          <span className="text-2xs text-destructive">Geçerli bir kupon kodu gir.</span>
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

      <Preview
        title="Select — leading icon + clearable"
        description="leadingIcon trigger'ın solunda; onClear verildiğinde chevron'un yanına X butonu gelir. Clear, Select'i açmaz — event propagation engellenir."
      >
        <ClearableSelectDemo />
      </Preview>

      <Preview
        title="Select — loading + invalid"
        description="loading async option fetch için (aria-busy + spinner, disable ETMEZ). invalid destructive border."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label>Mağaza (yükleniyor)</Label>
            <Select>
              <SelectTrigger leadingIcon={<Building03Icon />} loading loadingLabel={t('loading')}>
                <SelectValue placeholder="Mağazalar yükleniyor…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="x">Placeholder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label>Pazaryeri (invalid)</Label>
            <Select>
              <SelectTrigger invalid>
                <SelectValue placeholder="Bir pazaryeri seç" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trendyol">Trendyol</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-2xs text-destructive">Bu alan zorunlu.</span>
          </div>
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

function ClearableSelectDemo(): React.ReactElement {
  const t = useTranslations('common');
  const [value, setValue] = React.useState<string | undefined>('trendyol');

  return (
    <div className="max-w-input gap-3xs grid">
      <Label>Pazaryeri</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger
          leadingIcon={<Building03Icon />}
          {...(value !== undefined
            ? { onClear: () => setValue(undefined), clearLabel: t('clear') }
            : {})}
        >
          <SelectValue placeholder="Bir pazaryeri seç" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="trendyol">Trendyol</SelectItem>
          <SelectItem value="hepsiburada">Hepsiburada</SelectItem>
          <SelectItem value="n11">n11</SelectItem>
          <SelectItem value="amazon">Amazon</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-2xs text-muted-foreground">Seçim: {value ?? '(boş)'}</span>
    </div>
  );
}
