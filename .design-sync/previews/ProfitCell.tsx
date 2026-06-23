import { ProfitCell } from '@pazarsync/web';

export const Stacked = () => (
  <div className="gap-lg flex flex-col items-start">
    <ProfitCell value={142.5} delta={{ percent: 12.4, goodDirection: 'up' }} />
    <ProfitCell value={-12.4} delta={{ percent: -8.1, goodDirection: 'up' }} />
    <ProfitCell value={0} dimWhenZero />
  </div>
);

export const Inline = () => (
  <ProfitCell
    value={284390.45}
    delta={{ percent: 6.2, goodDirection: 'up' }}
    layout="inline"
    emphasis
  />
);
