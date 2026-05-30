'use client';

import {
  Building03Icon,
  Calendar01Icon,
  InformationCircleIcon,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
            <Label htmlFor="disabled-input">Devre dışı</Label>
            <Input id="disabled-input" disabled defaultValue="Değiştirilemez" />
          </div>
        </div>
      </Preview>

      <Preview
        title="Label — required · hata tonu · hint · peer-disabled"
        description="required dekoratif * ekler (alan ayrıca required taşımalı — aria-required). Hata tonu FormLabel'in text-destructive'i, transition-colors ile yumuşar. hint = etiket yanına Tooltip'li bilgi ikonu. peer-disabled YALNIZ checkbox/radio satırında (kontrol önce gelir) söner; üstte-yığılı alanlarda form düzeyinde."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="store-name" required>
              Mağaza adı
            </Label>
            <Input id="store-name" required placeholder="Zorunlu alan" />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="store-name-err" required className="text-destructive">
              Mağaza adı
            </Label>
            <Input id="store-name-err" required aria-invalid />
            <span className="text-2xs text-destructive">Bu alan zorunlu.</span>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label
              htmlFor="desi"
              hint={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} role="img" aria-label="Desi nedir?" className="cursor-help">
                      <InformationCircleIcon />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Desi = (en × boy × yükseklik) / 3000</TooltipContent>
                </Tooltip>
              }
            >
              Desi
            </Label>
            <Input id="desi" type="number" placeholder="0" className="tabular-nums" />
          </div>
          <div className="gap-xs flex items-center">
            <Checkbox id="peer-cb" disabled className="peer" />
            <Label htmlFor="peer-cb">Pasif seçenek (peer-disabled söner)</Label>
          </div>
        </div>
      </Preview>

      <Preview
        title="Input — valid · readOnly · sayaç · radius"
        description="valid = success border (invalid'in eşi; hatada shake, başarıda sakin). readOnly = gri yüzey + hover/glow YOK (düzenlenemez sinyali). showCount = sağda canlı length/maxLength. radius Button/Badge ile aynı eksen."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="iban-valid">IBAN</Label>
            <Input id="iban-valid" valid defaultValue="TR12 0006 1005 ..." />
            <span className="text-2xs text-success">Doğrulandı.</span>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="store-id-ro">Mağaza kimliği (readOnly)</Label>
            <Input id="store-id-ro" readOnly defaultValue="str_8f3a91c2" />
          </div>
          <div className="gap-3xs flex flex-col">
            <Label htmlFor="title-count">Başlık (showCount + maxLength)</Label>
            <Input id="title-count" showCount maxLength={50} defaultValue="PazarSync demo" />
          </div>
          <div className="gap-xs flex flex-wrap items-center">
            <Input radius="full" size="sm" placeholder="radius=full" />
            <Input radius="lg" size="sm" placeholder="radius=lg" />
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
        title="Reveal toggle (password / API key / secret)"
        description="type='password' + reveal prop → Input kendi görünürlük state'ini yönetir, trailing slot'u otomatik olarak Göster/Gizle butonuyla doldurur. Labels zorunlu (a11y disiplini) ve consumer'dan geçer."
      >
        <div className="max-w-form gap-3xs flex flex-col">
          <Label htmlFor="pw">Parola</Label>
          <Input
            id="pw"
            type="password"
            placeholder="En az 8 karakter"
            reveal={{ show: 'Göster', hide: 'Gizle' }}
          />
        </div>
      </Preview>

      <Preview
        title="Manual trailing slot (for non-reveal cases)"
        description="reveal prop password tipine özel. Başka senaryolarda (birim, kısa etiket, custom buton) trailing slot'u hâlâ serbest — content kendi aria-label'ını ve focus ring'ini yönetir."
      >
        <div className="max-w-form gap-3xs flex flex-col">
          <Label htmlFor="pw-manual">Manuel kontrol örneği</Label>
          <Input
            id="pw-manual"
            type={passwordVisible ? 'text' : 'password'}
            placeholder="Tam kontrol gerekirse"
            trailing={
              <button
                type="button"
                aria-label={passwordVisible ? 'Gizle' : 'Göster'}
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
        title="Textarea — valid · readOnly · disabled · size · resize"
        description="valid: success border. readOnly: gri yüzey, hover/glow yok. resize prop ('vertical' default / 'none' / 'both'). sm/lg paylaşılan size. Sayaç maxLength'e yaklaşınca warning rengine döner."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs grid">
            <Label htmlFor="tw-valid">Açıklama</Label>
            <Textarea id="tw-valid" valid defaultValue="Geçerli açıklama" rows={2} />
            <span className="text-2xs text-success">Doğrulandı.</span>
          </div>
          <div className="gap-3xs grid">
            <Label htmlFor="tw-ro">Sistem notu (readOnly)</Label>
            <Textarea
              id="tw-ro"
              readOnly
              defaultValue="Otomatik üretildi — düzenlenemez."
              rows={2}
            />
          </div>
          <div className="gap-3xs grid">
            <Label htmlFor="tw-disabled">Devre dışı</Label>
            <Textarea id="tw-disabled" disabled defaultValue="Kapalı" rows={2} />
          </div>
          <div className="gap-3xs grid">
            <Label htmlFor="tw-near">Başlık (sayaç warning)</Label>
            <Textarea
              id="tw-near"
              showCount
              maxLength={20}
              defaultValue="Limite yakın metin"
              rows={2}
            />
          </div>
          <div className="gap-xs grid">
            <Textarea size="sm" resize="none" placeholder="size=sm · resize=none" />
            <Textarea size="lg" resize="both" placeholder="size=lg · resize=both" rows={2} />
          </div>
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

      <Preview
        title="Select — valid + disabled"
        description="valid başarıyla doğrulanmış seçimi success border ile işaretler (invalid'in karşılığı). disabled trigger opacity-50 + cursor-not-allowed."
      >
        <div className="max-w-form gap-md grid">
          <div className="gap-3xs flex flex-col">
            <Label>Pazaryeri (valid)</Label>
            <Select defaultValue="trendyol">
              <SelectTrigger valid>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trendyol">Trendyol</SelectItem>
                <SelectItem value="hepsiburada">Hepsiburada</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-2xs text-success">Bağlantı doğrulandı.</span>
          </div>
          <div className="gap-3xs flex flex-col">
            <Label>Pazaryeri (disabled)</Label>
            <Select disabled defaultValue="trendyol">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="trendyol">Trendyol</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Preview>

      <Preview
        title="Select — size (paylaşılan prop)"
        description="sm (h-8) / md (h-10, default) / lg (h-11). Input ve Button ile aynı yükseklik ailesi — formda hizalı satırlar."
      >
        <div className="max-w-form gap-md grid">
          {SIZE_KEYS.map((size) => (
            <div key={size} className="gap-3xs flex flex-col">
              <Label className="text-2xs text-muted-foreground font-mono">size = {size}</Label>
              <Select>
                <SelectTrigger size={size}>
                  <SelectValue placeholder="Bir pazaryeri seç" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trendyol">Trendyol</SelectItem>
                  <SelectItem value="hepsiburada">Hepsiburada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Preview>

      <Preview
        title="Select — leadingIcon + description item"
        description="SelectItem leadingIcon (logo/durum) ve description (ikincil satır) alır. İkisi de ItemText dışında render edilir — ekran okuyucu yalnız ana etiketi okur."
      >
        <div className="max-w-input gap-3xs grid">
          <Label>Mağaza</Label>
          <Select defaultValue="store-1">
            <SelectTrigger leadingIcon={<Building03Icon />}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="store-1"
                leadingIcon={<Building03Icon />}
                description="Trendyol — Mağaza #1234"
              >
                Ana Mağaza
              </SelectItem>
              <SelectItem
                value="store-2"
                leadingIcon={<Building03Icon />}
                description="Hepsiburada — Mağaza #5678"
              >
                İkincil Mağaza
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Preview>

      <Preview
        title="Select — gruplu + ayraç + disabled item"
        description="SelectGroup + SelectLabel başlık, SelectSeparator gruplar arası çizgi, item bazında disabled. >6 seçeneği duruma göre kategorize etmenin standart deseni."
      >
        <div className="max-w-input-narrow gap-3xs grid">
          <Label>Mağaza durumu</Label>
          <Select defaultValue="active-1">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Aktif Mağazalar</SelectLabel>
                <SelectItem value="active-1">Trendyol — Ana</SelectItem>
                <SelectItem value="active-2">Hepsiburada — Ana</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Pasif Mağazalar</SelectLabel>
                <SelectItem value="passive-1" disabled>
                  n11 — Askıda
                </SelectItem>
                <SelectItem value="passive-2">Amazon — Bağlantı kesik</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </Preview>

      <Preview
        title="Checkbox — durumlar · tri-state · size"
        description={
          'Binary kontrol → checked full --primary (Toggle’ın primary-soft’undan ayrı). checked="indeterminate" tablo "tümünü seç" başlığı için minus gösterir; tik fade-in ile gelir. invalid/valid form doğrulama, sm/md/lg size ekseni.'
        }
      >
        <div className="gap-lg flex flex-col">
          <div className="gap-md flex flex-wrap items-center">
            <div className="gap-xs flex items-center">
              <Checkbox id="c1" />
              <Label htmlFor="c1">Varsayılan</Label>
            </div>
            <div className="gap-xs flex items-center">
              <Checkbox id="c2" defaultChecked />
              <Label htmlFor="c2">İşaretli</Label>
            </div>
            <div className="gap-xs flex items-center">
              <Checkbox id="c3" checked="indeterminate" />
              <Label htmlFor="c3">Kısmi (indeterminate)</Label>
            </div>
            <div className="gap-xs flex items-center">
              <Checkbox id="c4" disabled />
              <Label htmlFor="c4">Devre dışı</Label>
            </div>
            <div className="gap-xs flex items-center">
              <Checkbox id="c5" invalid />
              <Label htmlFor="c5">Hatalı (invalid)</Label>
            </div>
            <div className="gap-xs flex items-center">
              <Checkbox id="c6" valid defaultChecked />
              <Label htmlFor="c6">Doğrulandı (valid)</Label>
            </div>
          </div>
          <div className="gap-md flex items-center">
            {SIZE_KEYS.map((size) => (
              <div key={size} className="gap-xs flex items-center">
                <Checkbox id={`cb-${size}`} size={size} defaultChecked />
                <Label htmlFor={`cb-${size}`} className="text-2xs text-muted-foreground font-mono">
                  {size}
                </Label>
              </div>
            ))}
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
