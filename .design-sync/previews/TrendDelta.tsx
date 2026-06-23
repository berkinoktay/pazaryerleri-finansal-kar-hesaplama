import { TrendDelta } from '@pazarsync/web';

export const Revenue = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <TrendDelta value={12.4} goodDirection="up" />
    <TrendDelta value={-8.1} goodDirection="up" />
    <TrendDelta value={0} />
  </div>
);

export const CostMetric = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <TrendDelta value={-5.2} goodDirection="down" />
    <TrendDelta value={9.7} goodDirection="down" />
  </div>
);

export const Sizes = () => (
  <div className="gap-sm flex flex-wrap items-center">
    <TrendDelta value={12.4} size="sm" />
    <TrendDelta value={12.4} size="md" />
  </div>
);
