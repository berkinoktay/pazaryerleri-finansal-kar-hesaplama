import { CountBadge } from '@pazarsync/web';

export const Counts = () => (
  <div className="gap-lg flex items-center text-sm">
    <span className="gap-xs flex items-center">
      Bildirimler <CountBadge>3</CountBadge>
    </span>
    <span className="gap-xs flex items-center">
      Bekleyen <CountBadge tone="warning">12</CountBadge>
    </span>
    <span className="gap-xs flex items-center">
      Hatalı <CountBadge tone="destructive">99+</CountBadge>
    </span>
  </div>
);
