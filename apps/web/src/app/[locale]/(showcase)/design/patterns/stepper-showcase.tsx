'use client';

import * as React from 'react';

import { Playground, control } from '@/components/showcase/playground';
import { Stepper, type StepperStep } from '@/components/patterns/stepper';

/**
 * Realistic content: the four stages of connecting a marketplace
 * store. The Wizard organism composes a Stepper with these exact
 * step definitions plus a per-step content pane (see WizardShowcase).
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

// cursor seçenekleri: 0–3 adım indeksleri + 4 = "tümü tamamlandı".
const CURSOR_OPTIONS = ['0', '1', '2', '3', '4'] as const;
// API-anahtarı adımının (index 1) state'ini error'a çevirir.
const ERROR_STEP_INDEX = 1;

export function StepperShowcase(): React.ReactElement {
  return (
    <Playground
      title="Stepper — cursor · orientation · hideLabels · adım hatası"
      description="Per-step state cursor'dan türetilir: index < cursor → completed (yeşil tik), == cursor → current (vurgulu numara), > cursor → upcoming (muted). 'errorAtStep' API-anahtarı adımını error'a (X) çevirir — kullanıcı ileri gitse bile görünür kalır. Dikey = kontekst rail; yatay = wizard üstü."
      controls={{
        cursor: control.segment(CURSOR_OPTIONS, '2'),
        orientation: control.segment(['horizontal', 'vertical'], 'horizontal'),
        hideLabels: control.bool(false, 'hideLabels'),
        errorAtStep: control.bool(false, 'errorAtStep'),
      }}
      render={(v) => (
        <Stepper
          steps={
            v.errorAtStep
              ? CONNECT_STORE_STEPS.map((step, index) =>
                  index === ERROR_STEP_INDEX ? { ...step, state: 'error' } : step,
                )
              : CONNECT_STORE_STEPS
          }
          current={Number(v.cursor)}
          orientation={v.orientation}
          hideLabels={v.hideLabels}
          aria-label="Mağaza bağlama adımları"
          className={v.orientation === 'vertical' ? 'max-w-input' : 'w-full'}
        />
      )}
    />
  );
}
