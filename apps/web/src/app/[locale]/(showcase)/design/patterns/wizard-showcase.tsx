'use client';

import { CheckmarkCircle02Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';

import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';
import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Wizard, type WizardStep } from '@/components/patterns/wizard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MARKETPLACE_OPTIONS: ComboboxOption[] = [
  {
    value: 'TRENDYOL',
    label: 'Trendyol',
    description: 'Pazaryeri (TR)',
    icon: <MarketplaceLogo platform="TRENDYOL" size="xs" alt="" />,
  },
  {
    value: 'HEPSIBURADA',
    label: 'Hepsiburada',
    description: 'Pazaryeri (TR)',
    icon: <MarketplaceLogo platform="HEPSIBURADA" size="xs" alt="" />,
  },
];

interface DraftState {
  name: string;
  marketplace: string | null;
  apiKey: string;
  apiSecret: string;
  verified: boolean;
}

function StepDetails({
  draft,
  onChange,
}: {
  draft: DraftState;
  onChange: (next: Partial<DraftState>) => void;
}): React.ReactElement {
  return (
    <div className="gap-md grid sm:grid-cols-2">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="store-name">Mağaza adı</Label>
        <Input
          id="store-name"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Örn. Trendyol Ana Mağaza"
        />
      </div>
      <div className="gap-3xs flex flex-col">
        <Label>Pazaryeri</Label>
        <Combobox
          value={draft.marketplace}
          onChange={(next) => onChange({ marketplace: next })}
          options={MARKETPLACE_OPTIONS}
          placeholder="Pazaryeri seç…"
        />
      </div>
    </div>
  );
}

function StepCredentials({
  draft,
  onChange,
}: {
  draft: DraftState;
  onChange: (next: Partial<DraftState>) => void;
}): React.ReactElement {
  return (
    <div className="gap-md flex flex-col">
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="api-key">API anahtarı</Label>
        <Input
          id="api-key"
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value, verified: false })}
          placeholder="••••••••"
          reveal={{ show: 'Göster', hide: 'Gizle' }}
        />
      </div>
      <div className="gap-3xs flex flex-col">
        <Label htmlFor="api-secret">API gizli anahtarı</Label>
        <Input
          id="api-secret"
          type="password"
          value={draft.apiSecret}
          onChange={(event) => onChange({ apiSecret: event.target.value, verified: false })}
          placeholder="••••••••"
          reveal={{ show: 'Göster', hide: 'Gizle' }}
        />
      </div>
      <p className="text-2xs text-muted-foreground">
        Trendyol panelinden &gt; Entegrasyon Yönetimi &gt; API Anahtarları sayfasından alabilirsin.
        Anahtarlar AES-256-GCM ile şifrelenip saklanır.
      </p>
    </div>
  );
}

function StepVerify({ verified }: { verified: boolean }): React.ReactElement {
  return (
    <div className="gap-md flex flex-col">
      <div className="gap-sm border-border bg-card p-md flex items-start rounded-md border">
        <CheckmarkCircle02Icon
          className={verified ? 'size-icon text-success' : 'size-icon text-muted-foreground'}
          aria-hidden
        />
        <div className="gap-3xs flex flex-col">
          <span className="text-foreground text-sm font-medium">
            {verified ? 'Bağlantı doğrulandı' : 'Bağlantıyı test edeceğiz'}
          </span>
          <span className="text-2xs text-muted-foreground">
            {verified
              ? 'Test çağrısı başarılı. Sıradaki adımda ilk senkronizasyonu başlatabilirsin.'
              : '"Doğrula ve devam et" butonu API çağrısı yapar; başarılı olursa otomatik ilerlersin.'}
          </span>
        </div>
      </div>
    </div>
  );
}

function StepSync({ name }: { name: string }): React.ReactElement {
  const items = [
    'Sipariş geçmişi (son 30 gün) çekilir',
    'Aktif ürün katalogu içe aktarılır',
    'Hakediş raporları eşleştirilir',
  ];
  return (
    <div className="gap-md flex flex-col">
      <p className="text-foreground text-sm">
        <strong className="font-semibold">{name || 'Mağazanız'}</strong> için ilk senkronizasyon
        başlatılacak. Bu birkaç dakika sürebilir; arka planda devam ederken paneli kullanmaya devam
        edebilirsin.
      </p>
      <ul className="gap-xs flex flex-col">
        {items.map((item) => (
          <li key={item} className="gap-xs flex items-center text-sm">
            <Tick02Icon className="size-icon-sm text-success shrink-0" aria-hidden />
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WizardShowcase(): React.ReactElement {
  const [current, setCurrent] = React.useState(0);
  const [draft, setDraft] = React.useState<DraftState>({
    name: '',
    marketplace: null,
    apiKey: '',
    apiSecret: '',
    verified: false,
  });
  const [completed, setCompleted] = React.useState(false);

  const updateDraft = React.useCallback((next: Partial<DraftState>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  const verifyConnection = React.useCallback(async () => {
    // Synthetic delay so the spinner is visible in the showcase.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setDraft((prev) => ({ ...prev, verified: true }));
  }, []);

  const handleComplete = React.useCallback(() => {
    setCompleted(true);
  }, []);

  const reset = React.useCallback(() => {
    setCurrent(0);
    setDraft({ name: '', marketplace: null, apiKey: '', apiSecret: '', verified: false });
    setCompleted(false);
  }, []);

  const steps: WizardStep[] = [
    {
      id: 'details',
      label: 'Mağaza bilgileri',
      description: 'İsim ve pazaryeri',
      content: <StepDetails draft={draft} onChange={updateDraft} />,
      canAdvance: draft.name.trim().length > 0 && draft.marketplace !== null,
    },
    {
      id: 'credentials',
      label: 'API anahtarları',
      description: 'Trendyol panelinden',
      content: <StepCredentials draft={draft} onChange={updateDraft} />,
      canAdvance: draft.apiKey.trim().length > 0 && draft.apiSecret.trim().length > 0,
    },
    {
      id: 'verify',
      label: 'Bağlantıyı doğrula',
      description: 'Test çağrısı',
      content: <StepVerify verified={draft.verified} />,
      nextLabel: draft.verified ? 'Devam et' : 'Doğrula ve devam et',
      onAdvance: draft.verified ? undefined : verifyConnection,
    },
    {
      id: 'sync',
      label: 'İlk senkron',
      description: 'Sipariş + ürün çekimi',
      content: <StepSync name={draft.name} />,
      nextLabel: 'Senkronu başlat',
    },
  ];

  if (completed) {
    return (
      <div className="gap-md border-border bg-card p-lg flex flex-col items-center rounded-md border text-center">
        <CheckmarkCircle02Icon className="size-icon-xl text-success" aria-hidden />
        <div className="gap-3xs flex flex-col">
          <span className="text-foreground text-md font-semibold">
            {draft.name || 'Mağaza'} bağlandı
          </span>
          <span className="text-2xs text-muted-foreground">
            İlk senkronizasyon arka planda başladı. Tamamlandığında bildirim alacaksın.
          </span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-2xs text-primary hover:text-primary/80 underline-offset-4 hover:underline"
        >
          Showcase&apos;ı sıfırla
        </button>
      </div>
    );
  }

  return (
    <Wizard
      steps={steps}
      current={current}
      onCurrentChange={setCurrent}
      onComplete={handleComplete}
      stepperAriaLabel="Mağaza bağlama akışı"
    />
  );
}
