import { TimeAgo } from '@pazarsync/web';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const Relative = () => (
  <div className="gap-xs text-foreground flex flex-col text-sm">
    <TimeAgo value={new Date(Date.now() - 2 * MIN)} />
    <TimeAgo value={new Date(Date.now() - 3 * HOUR)} timezone="GMT+3" />
    <TimeAgo value={new Date(Date.now() - 2 * DAY)} />
  </div>
);

export const Empty = () => (
  <div className="text-muted-foreground text-sm">
    <TimeAgo value={null} />
  </div>
);
