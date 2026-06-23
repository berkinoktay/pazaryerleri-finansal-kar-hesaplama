import { DateInput } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-input-narrow w-full">
    <DateInput value={new Date('2026-06-23')} onChange={() => {}} />
  </div>
);
