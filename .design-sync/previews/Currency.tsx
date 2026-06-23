import { Currency } from '@pazarsync/web';

export const Values = () => (
  <div className="gap-xs text-md flex flex-col">
    <Currency value={284390.45} />
    <Currency value={1290.5} />
    <Currency value={-4820.9} />
  </div>
);

export const Emphasis = () => (
  <div className="gap-sm flex flex-col">
    <Currency value={128450.75} emphasis className="text-2xl" />
    <Currency value={284390.45} className="text-2xl" />
  </div>
);

export const DimWhenZero = () => (
  <div className="gap-xs text-md flex flex-col">
    <Currency value={0} dimWhenZero />
    <Currency value={1540.75} dimWhenZero />
  </div>
);
