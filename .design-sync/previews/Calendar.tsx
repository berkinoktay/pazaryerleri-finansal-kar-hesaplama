import { Calendar } from '@pazarsync/web';

export const Default = () => (
  <Calendar mode="single" selected={new Date('2026-06-23')} defaultMonth={new Date('2026-06-23')} />
);
