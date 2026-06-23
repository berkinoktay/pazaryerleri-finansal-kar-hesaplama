import { Stepper } from '@pazarsync/web';

const STEPS = [
  { id: 'connect', label: 'Mağaza bağla' },
  { id: 'sync', label: 'Senkronize et' },
  { id: 'cost', label: 'Maliyet gir' },
  { id: 'profit', label: 'Kârı gör' },
];

export const Horizontal = () => (
  <div className="max-w-modal w-full">
    <Stepper steps={STEPS} current={2} />
  </div>
);

export const Vertical = () => <Stepper steps={STEPS} current={2} orientation="vertical" />;
