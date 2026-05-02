'use client';

import * as React from 'react';

import { Stepper, type StepperStep } from '@/components/patterns/stepper';

/**
 * Realistic content: the four stages of connecting a marketplace
 * store. The Wizard organism (not built yet) will compose Stepper
 * with these exact step definitions plus a per-step content pane.
 */
const CONNECT_STORE_STEPS: StepperStep[] = [
  {
    id: 'details',
    label: 'Mağaza bilgileri',
    description: 'İsim ve pazaryeri seçimi',
  },
  {
    id: 'credentials',
    label: 'API anahtarları',
    description: 'Trendyol panelinden al',
  },
  {
    id: 'verify',
    label: 'Bağlantıyı doğrula',
    description: 'Test çağrısı yap',
  },
  {
    id: 'sync',
    label: 'İlk senkron',
    description: 'Sipariş ve ürün çekimi',
  },
];

/**
 * Settlement reconciliation flow — vertical Stepper variant fits a
 * sidebar / context-rail layout where steps stack and need full-text
 * descriptions next to each indicator.
 */
const RECONCILIATION_STEPS: StepperStep[] = [
  {
    id: 'upload',
    label: 'Hakediş dosyasını yükle',
    description: 'Trendyol panelinden CSV indir, sürükle-bırak.',
  },
  {
    id: 'parse',
    label: 'Satırları eşleştir',
    description: 'Sipariş numaralarını PazarSync verisiyle eşle.',
  },
  {
    id: 'review',
    label: 'Sapmaları gözden geçir',
    description: 'Mismatch bulunan satırları tek tek onayla.',
  },
  {
    id: 'commit',
    label: 'Mutabakatı tamamla',
    description: 'Hakediş raporu finalize edilir.',
  },
];

export function StepperShowcase(): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Yatay · cursor 2 (Doğrulama adımında)
        </span>
        <Stepper steps={CONNECT_STORE_STEPS} current={2} aria-label="Mağaza bağlama adımları" />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Yatay · API anahtarı adımında hata
        </span>
        <Stepper
          steps={CONNECT_STORE_STEPS.map((step, index) =>
            index === 1 ? { ...step, state: 'error' } : step,
          )}
          current={2}
          aria-label="Mağaza bağlama — geçersiz API anahtarı"
        />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Yatay · tüm adımlar tamamlandı
        </span>
        <Stepper
          steps={CONNECT_STORE_STEPS}
          current={CONNECT_STORE_STEPS.length}
          aria-label="Mağaza bağlama tamamlandı"
        />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Yatay · etiketler gizli (kompakt)
        </span>
        <Stepper
          steps={CONNECT_STORE_STEPS}
          current={1}
          hideLabels
          aria-label="Mağaza bağlama — kompakt"
        />
      </div>

      <div className="gap-sm flex flex-col">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          Dikey · mutabakat akışı (cursor 1)
        </span>
        <Stepper
          steps={RECONCILIATION_STEPS}
          current={1}
          orientation="vertical"
          aria-label="Hakediş mutabakatı adımları"
          className="max-w-input"
        />
      </div>
    </div>
  );
}
