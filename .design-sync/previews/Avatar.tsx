import { Avatar, AvatarFallback, AvatarGroup, StatusDot } from '@pazarsync/web';

export const Sizes = () => (
  <div className="gap-md flex items-center">
    <Avatar size="sm">
      <AvatarFallback>BO</AvatarFallback>
    </Avatar>
    <Avatar size="md">
      <AvatarFallback tone="primary">TY</AvatarFallback>
    </Avatar>
    <Avatar size="lg">
      <AvatarFallback tone="success">HB</AvatarFallback>
    </Avatar>
  </div>
);

export const Group = () => (
  <AvatarGroup max={3}>
    <Avatar>
      <AvatarFallback>BO</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback tone="success">AS</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback tone="warning">MK</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback tone="info">EY</AvatarFallback>
    </Avatar>
    <Avatar>
      <AvatarFallback tone="destructive">RC</AvatarFallback>
    </Avatar>
  </AvatarGroup>
);

export const WithIndicator = () => (
  <Avatar size="lg" indicator={<StatusDot tone="success" />}>
    <AvatarFallback>BO</AvatarFallback>
  </Avatar>
);
