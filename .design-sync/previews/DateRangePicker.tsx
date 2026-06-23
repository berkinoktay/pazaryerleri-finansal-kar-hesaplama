import { DateRangePicker } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-input w-full">
    <DateRangePicker
      value={{ from: new Date('2026-06-01'), to: new Date('2026-06-23') }}
      onChange={() => {}}
    />
  </div>
);
