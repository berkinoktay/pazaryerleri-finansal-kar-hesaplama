import { RangeInput } from '@pazarsync/web';

export const Price = () => (
  <div className="max-w-input w-full">
    <RangeInput min="50" max="500" onMinChange={() => {}} onMaxChange={() => {}} unit="₺" />
  </div>
);
