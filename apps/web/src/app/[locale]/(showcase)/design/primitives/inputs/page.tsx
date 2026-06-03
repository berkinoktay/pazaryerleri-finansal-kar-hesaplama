'use client';

import { Building03Icon, Calendar01Icon, Search01Icon, UserIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { CategoryNav } from '@/components/showcase/category-nav';
import { Playground, control } from '@/components/showcase/playground';
import { Preview } from '@/components/showcase/preview';
import { ShowcaseSection } from '@/components/showcase/section';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
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
import { Link } from '@/i18n/navigation';
import { type RadiusKey, RADIUS_KEYS, type SizeKey, SIZE_KEYS } from '@/lib/variants';

export default function InputsPrimitivePage(): React.ReactElement {
  const t = useTranslations('common');

  return (
    <>
      <PageHeader
        title="Form alanları"
        intent="Tüm giriş kontrolleri Button ile aynı size ailesini (sm/md/lg) ve radius eksenini paylaşır — formda tutarlı yükseklik ve köşe. Her bileşenin prop matrisini kontrol şeridinden canlı çevir; statik 'her durumu yan yana' bloklarının yerini Playground aldı. Label her zaman placeholder'dan önce; aria-invalid hatalı alan için."
      />
      <CategoryNav section="primitives" />

      <ShowcaseSection
        title="Input"
        description="Tek satır metin alanı. Adornment slot'ları (leading/trailing ikon, clear, sayaç), loading, invalid/valid ve radius tek yüzeyde toplanır. Kontrolleri çevirerek tüm prop matrisini gör; davranışsal demolar (clearable, reveal, async) altta ayrı kalır."
      >
        <Playground
          title="Input — size · radius · invalid · valid · loading · adornment'lar"
          description="Tek etkileşimli yüzey; eski 11 statik Input Preview'unun config kısmını toplar. leadingIcon/trailingIcon/clearable/showCount boolean'ları slot'ları açar."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            invalid: control.bool(false),
            valid: control.bool(false),
            disabled: control.bool(false),
            loading: control.bool(false),
            leadingIcon: control.bool(true, 'leadingIcon'),
            trailingIcon: control.bool(false, 'trailingIcon'),
            clearable: control.bool(false),
            showCount: control.bool(false),
          }}
          render={(v) => (
            <Input
              size={v.size}
              radius={v.radius}
              invalid={v.invalid}
              valid={v.valid}
              disabled={v.disabled}
              loading={v.loading}
              loadingLabel={t('loading')}
              leadingIcon={v.leadingIcon ? <Search01Icon /> : undefined}
              trailingIcon={v.trailingIcon ? <Calendar01Icon /> : undefined}
              showCount={v.showCount}
              maxLength={v.showCount ? 50 : undefined}
              {...(v.clearable ? { onClear: () => undefined, clearLabel: t('clear') } : {})}
              defaultValue="PazarSync demo"
              placeholder="Sipariş, müşteri, SKU…"
              aria-label="Input demo"
              className="max-w-input"
            />
          )}
        />

        <Preview
          title="Input + Label (form satırı)"
          description="Placeholder label değildir — Label her zaman üstte. aria-invalid hatalı alanı kırmızı kenarla işaretler, readOnly gri yüzey + hover/glow YOK (düzenlenemez sinyali)."
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
              <Label htmlFor="store-id-ro">Mağaza kimliği (readOnly)</Label>
              <Input id="store-id-ro" readOnly defaultValue="str_8f3a91c2" />
            </div>
          </div>
        </Preview>

        <Preview
          title="Clearable (onClear — etkileşimli)"
          description="Value doluyken sağda X butonu çıkar. Klavye erişilebilir, aria-label i18n'den; pointer-coarse altında dokunma alanı genişler. Yazıp temizleyerek canlı gör."
        >
          <ClearableInputDemo clearLabel={t('clear')} />
        </Preview>

        <Preview
          title="Reveal toggle (parola / API anahtarı)"
          description="type='password' + reveal prop → Input kendi görünürlük state'ini yönetir, trailing slot'u otomatik Göster/Gizle butonuyla doldurur. Labels zorunlu (a11y) ve consumer'dan geçer."
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
          title="Serbest leading / trailing slot (kompozisyon)"
          description="Icon yerine metin, kbd ipucu, birim — her şey geçer. leadingIcon/trailingIcon ile aynı slotlar ama içerik olduğu gibi render edilir (auto-color yok). invalid + ikon birlikte de çalışır."
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
            <div className="gap-3xs flex flex-col">
              <Label htmlFor="user-leading">Kullanıcı (icon + invalid)</Label>
              <Input id="user-leading" leadingIcon={<UserIcon />} invalid defaultValue="!!" />
              <span className="text-2xs text-destructive">En az 2 harf içermeli.</span>
            </div>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Textarea"
        description="Çok satır metin alanı. size/invalid/valid/disabled/readOnly tek yüzeyde; sayaç (maxLength) ve içeriğe-göre büyüme (autoResize) davranışları ayrı demolarda."
      >
        <Playground
          title="Textarea — size · invalid · valid · disabled · readOnly"
          description="Config prop'ları tek şeritte. Sayaç/auto-resize davranışları aşağıda kalır (kontrol ifade edemediği için)."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            invalid: control.bool(false),
            valid: control.bool(false),
            disabled: control.bool(false),
            readOnly: control.bool(false),
          }}
          render={(v) => (
            <Textarea
              size={v.size}
              invalid={v.invalid}
              valid={v.valid}
              disabled={v.disabled}
              readOnly={v.readOnly}
              defaultValue="İstanbul - Kadıköy deposundan gönderildi."
              placeholder="Sipariş hakkında not…"
              rows={3}
              aria-label="Textarea demo"
              className="max-w-form"
            />
          )}
        />

        <Preview
          title="Textarea — sayaç (maxLength)"
          description="maxLength verildiğinde counter otomatik gösterilir; limite yaklaşınca warning, aşınca destructive rengine döner. aria-live=polite ile ekran okuyucu sayımı anons eder."
        >
          <div className="max-w-form gap-3xs grid">
            <Label htmlFor="tw-max">Açıklama (en fazla 20 karakter — warning yakın)</Label>
            <Textarea
              id="tw-max"
              showCount
              maxLength={20}
              placeholder="Kısa bir özet…"
              rows={3}
              defaultValue="Limite yakın metin"
            />
          </div>
        </Preview>

        <Preview
          title="Textarea — auto-resize (yapısal)"
          description="İçeriğe göre büyür (grid mirror pattern — height animate edilmez, caret stabil kalır). maxRows ile tavan konur; üstünde kendi içinde kaydırır."
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
      </ShowcaseSection>

      <ShowcaseSection
        title="Select"
        description="Radix tabanlı tek-seçim açılır liste. Trigger; size/radius/invalid/valid/loading/leadingIcon prop'larını taşır ve Input/Button ile aynı yükseklik ailesini paylaşır. Clearable, açıklamalı item ve gruplama davranışları ayrı demolarda."
      >
        <Playground
          title="Select trigger — size · radius · invalid · valid · loading · disabled"
          description="Trigger'ın config prop'ları tek şeritte. leadingIcon boolean'ı trigger'ın solundaki ikonu açar; loading aria-busy + spinner verir ama trigger'ı disable ETMEZ."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'md'),
            invalid: control.bool(false),
            valid: control.bool(false),
            loading: control.bool(false),
            disabled: control.bool(false),
            leadingIcon: control.bool(false, 'leadingIcon'),
          }}
          render={(v) => (
            <Select disabled={v.disabled} defaultValue="trendyol">
              <SelectTrigger
                size={v.size}
                radius={v.radius}
                invalid={v.invalid}
                valid={v.valid}
                loading={v.loading}
                loadingLabel={t('loading')}
                leadingIcon={v.leadingIcon ? <Building03Icon /> : undefined}
                aria-label="Select demo"
                className="max-w-input"
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
          )}
        />

        <Preview
          title="Select — leading icon + clearable (etkileşimli)"
          description="leadingIcon trigger'ın solunda; onClear verildiğinde chevron'un yanına X gelir. Clear Select'i açmaz — event propagation engellenir (trigger button içinde role=button span)."
        >
          <ClearableSelectDemo clearLabel={t('clear')} />
        </Preview>

        <Preview
          title="Select — leadingIcon + description item (kompozisyon)"
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
          title="Select — gruplu + ayraç + disabled item (yapısal)"
          description="SelectGroup + SelectLabel başlık, SelectSeparator gruplar arası çizgi, item bazında disabled. >6 seçeneği kategorize etmenin standart deseni."
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
      </ShowcaseSection>

      <ShowcaseSection
        title="Checkbox"
        description="Formda commit eden binary (ya da tri-state) kontrol → checked full --primary (Toggle'ın primary-soft'undan ayrı). indeterminate tablo 'tümünü seç' başlığı için minus gösterir; tik fade-in ile gelir."
      >
        <Playground
          title="Checkbox — size · radius · invalid · valid · disabled · indeterminate"
          description="checked/unchecked state'i bileşenin kendisi yönetir (tıkla); kontroller config prop'larını çevirir. indeterminate açıkken kutu kontrollü kısmi-duruma geçer (minus)."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            radius: control.select(RADIUS_KEYS, 'xs'),
            invalid: control.bool(false),
            valid: control.bool(false),
            disabled: control.bool(false),
            indeterminate: control.bool(false),
          }}
          render={(v) => (
            <div className="gap-xs flex items-center">
              <CheckboxPlaygroundField
                size={v.size}
                radius={v.radius}
                invalid={v.invalid}
                valid={v.valid}
                disabled={v.disabled}
                indeterminate={v.indeterminate}
              />
              <Label htmlFor="cb-demo">Tümünü seç</Label>
            </div>
          )}
        />
      </ShowcaseSection>

      <ShowcaseSection
        title="Switch"
        description="Anlık açık/kapalı (Checkbox = formda commit). Binary → açık full --primary, 150ms ease-out-quart thumb kayması. Odakta dar offset ring (20px'te kutu-glow yerine)."
      >
        <Playground
          title="Switch — size · disabled · invalid · valid"
          description="on/off state'i bileşenin kendisi yönetir (tıkla); kontroller görünüm prop'larını çevirir. invalid/valid track'e offset ring ekler (border değil — filled track'te border görünmez)."
          controls={{
            size: control.segment(SIZE_KEYS, 'md'),
            disabled: control.bool(false),
            invalid: control.bool(false),
            valid: control.bool(false),
          }}
          render={(v) => (
            <div className="gap-xs flex items-center">
              <Switch
                id="sw-demo"
                size={v.size}
                disabled={v.disabled}
                invalid={v.invalid}
                valid={v.valid}
                defaultChecked
              />
              <Label htmlFor="sw-demo">Otomatik senkron</Label>
            </div>
          )}
        />
      </ShowcaseSection>

      <ShowcaseSection
        title="RadioGroup, Slider, OTP & Kbd"
        description="Grup/aralık/yapısal kontroller — bunlar bir tek prop'la özetlenmez (kümeler, range, slot dizileri), bu yüzden derli toplu Preview olarak kalır."
      >
        <Preview
          title="RadioGroup — size · disabled · orientation"
          description="Binary kontrol → nokta full --primary (toggle'ın soft'undan ayrı). size ekseni (nokta orantılı, seçince zoom-in pop); item bazında disabled; orientation='horizontal' satır düzeni + ok-tuşu yönü."
        >
          <div className="gap-lg flex flex-col">
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
                <RadioGroupItem value="quarterly" id="r3" disabled />
                <Label htmlFor="r3">Çeyrek dönem (disabled)</Label>
              </div>
            </RadioGroup>

            <RadioGroup
              defaultValue="md-r"
              orientation="horizontal"
              className="gap-md grid-flow-col"
            >
              {SIZE_KEYS.map((size) => (
                <div key={size} className="gap-xs flex items-center">
                  <RadioGroupItem value={`${size}-r`} id={`r-${size}`} size={size} />
                  <Label htmlFor={`r-${size}`} className="text-2xs text-muted-foreground font-mono">
                    {size}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </Preview>

        <Preview
          title="Slider — range · disabled · tooltip · formatValue"
          description="Flat dolu --primary thumb. İki-elemanlı value = range picker; disabled tüm kontrolü soldurur. tooltip = thumb üstünde değer balonu (hover/sürükleme/klavye); formatValue hem balonu hem aria-valuetext'i biçimler (₺, %)."
        >
          <SliderDemo />
        </Preview>

        <Preview
          title="InputOTP"
          description="2FA / SMS kodu doğrulama. Tabular-nums, auto-focus ilerleme, Paste desteği. Aktif slot field-focus (border-ring + glow), caret hard-blink. invalid → destructive border + shake."
        >
          <div className="gap-md flex flex-col">
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
            <div className="gap-2xs flex flex-col">
              <InputOTP maxLength={6} invalid defaultValue="123">
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
              <span className="text-2xs text-destructive">invalid — geçersiz kod</span>
            </div>
          </div>
        </Preview>

        <Preview
          title="Kbd"
          description="Klavye tuş kapağı — token-driven üniform kare. Tek tuşlar (⌘ K ? Esc) hizalanır; KbdGroup ile akor (⌘⇧P). Komut paleti ipuçları ve dokümantasyon için."
        >
          <div className="gap-md flex flex-wrap items-center">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <Kbd>?</Kbd>
            <Kbd>Esc</Kbd>
            <Kbd>⏎</Kbd>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>P</Kbd>
            </KbdGroup>
          </div>
        </Preview>
      </ShowcaseSection>

      <ShowcaseSection
        title="Label"
        description="Form etiketi — required dekoratif * ekler (alan ayrıca aria-required taşımalı), hata tonu text-destructive ile transition-colors, peer-disabled YALNIZ kontrol-önce satırlarda (checkbox/radio) söner."
      >
        <Preview
          title="Label — required · hata tonu · peer-disabled"
          description="required * ekler; hata tonu FormLabel'in text-destructive'i. peer-disabled checkbox/radio satırında (kontrol önce gelir) etiketi söndürür. Tooltip'li bilgi ikonu (hint) için Overlay sayfasındaki Tooltip demosuna bak."
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
            <div className="gap-xs flex items-center">
              <Checkbox id="peer-cb" disabled className="peer" />
              <Label htmlFor="peer-cb">Pasif seçenek (peer-disabled söner)</Label>
            </div>
          </div>
        </Preview>
        <p className="text-2xs text-muted-foreground">
          Label hint slot&apos;undaki Tooltip için kanonik demo:{' '}
          <Link href="/design/primitives/overlays" className="underline underline-offset-2">
            /design/primitives/overlays
          </Link>
        </p>
      </ShowcaseSection>
    </>
  );
}

interface CheckboxPlaygroundFieldProps {
  size: SizeKey;
  radius: RadiusKey;
  invalid: boolean;
  valid: boolean;
  disabled: boolean;
  indeterminate: boolean;
}

/**
 * Fully-controlled Checkbox for the Playground so toggling the `indeterminate`
 * control never crosses the controlled↔uncontrolled boundary (which would log a
 * React warning). `checked` is always a `CheckedState`; the `indeterminate`
 * control forces the partial state, and clicking flips checked/unchecked.
 */
function CheckboxPlaygroundField({
  size,
  radius,
  invalid,
  valid,
  disabled,
  indeterminate,
}: CheckboxPlaygroundFieldProps): React.ReactElement {
  const [checked, setChecked] = React.useState<boolean | 'indeterminate'>(true);
  const effectiveChecked = indeterminate ? 'indeterminate' : checked;

  return (
    <Checkbox
      id="cb-demo"
      size={size}
      radius={radius}
      invalid={invalid}
      valid={valid}
      disabled={disabled}
      checked={effectiveChecked}
      onCheckedChange={(next) => setChecked(next)}
    />
  );
}

function ClearableInputDemo({ clearLabel }: { clearLabel: string }): React.ReactElement {
  const [query, setQuery] = React.useState('sipariş');

  return (
    <div className="max-w-form gap-3xs flex flex-col">
      <Label htmlFor="q-clear">Sipariş ara (controlled)</Label>
      <Input
        id="q-clear"
        leadingIcon={<Search01Icon />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
        clearLabel={clearLabel}
        placeholder="Sipariş numarası…"
      />
      <span className="text-2xs text-muted-foreground">Değer: &quot;{query}&quot;</span>
    </div>
  );
}

function ClearableSelectDemo({ clearLabel }: { clearLabel: string }): React.ReactElement {
  const [value, setValue] = React.useState<string | undefined>('trendyol');

  return (
    <div className="max-w-input gap-3xs grid">
      <Label>Pazaryeri</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger
          leadingIcon={<Building03Icon />}
          {...(value !== undefined ? { onClear: () => setValue(undefined), clearLabel } : {})}
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

function SliderDemo(): React.ReactElement {
  const [price, setPrice] = React.useState<number[]>([120]);

  return (
    <div className="max-w-input gap-lg grid">
      <div className="gap-sm grid">
        <div className="flex items-center justify-between text-sm">
          <Label>Net kar hedefi</Label>
          <span className="text-foreground font-mono tabular-nums">₺{price[0]?.toFixed(0)}</span>
        </div>
        <Slider value={price} onValueChange={setPrice} min={0} max={500} step={5} />
      </div>
      <div className="gap-3xs grid">
        <Label className="text-2xs text-muted-foreground">Range (iki thumb)</Label>
        <Slider defaultValue={[120, 360]} min={0} max={500} step={5} />
      </div>
      <div className="gap-3xs grid">
        <Label className="text-2xs text-muted-foreground">Devre dışı</Label>
        <Slider defaultValue={[200]} min={0} max={500} disabled />
      </div>
      <div className="gap-xl pt-lg grid">
        <div className="gap-3xs grid">
          <Label>Komisyon eşiği (₺ — üzerine gel)</Label>
          <Slider
            tooltip
            formatValue={(v) => `₺${v}`}
            defaultValue={[180]}
            min={0}
            max={500}
            step={5}
          />
        </div>
        <div className="gap-3xs grid">
          <Label className="text-2xs text-muted-foreground">Kâr marjı aralığı (%)</Label>
          <Slider
            tooltip
            formatValue={(v) => `%${v}`}
            defaultValue={[15, 40]}
            min={0}
            max={100}
            step={1}
          />
        </div>
      </div>
    </div>
  );
}
