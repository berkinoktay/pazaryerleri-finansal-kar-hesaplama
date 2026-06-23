import { Sparkline, Currency } from '@pazarsync/web';

export const InlineTrend = () => (
  <div className="gap-md flex flex-col">
    <div className="gap-sm flex items-center">
      <Currency value={284390.45} emphasis />
      <Sparkline data={[12, 18, 14, 22, 19, 26, 31]} tone="success" />
    </div>
    <div className="gap-sm flex items-center">
      <Currency value={4820.9} emphasis />
      <Sparkline data={[31, 26, 28, 20, 22, 16, 12]} tone="destructive" />
    </div>
  </div>
);

export const Variants = () => (
  <div className="gap-md flex items-center">
    <Sparkline data={[8, 14, 11, 18, 22, 19, 27]} variant="line" tone="info" />
    <Sparkline data={[8, 14, 11, 18, 22, 19, 27]} variant="area" tone="info" />
    <Sparkline data={[8, 14, 11, 18, 22, 19, 27]} variant="bars" tone="info" />
  </div>
);
