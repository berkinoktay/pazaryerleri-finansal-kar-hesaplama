import { BadgeWithOverflow, Badge } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-form w-full">
    <BadgeWithOverflow overflowCount={3}>
      <Badge>Elektronik</Badge>
      <Badge>Aksesuar</Badge>
    </BadgeWithOverflow>
  </div>
);
