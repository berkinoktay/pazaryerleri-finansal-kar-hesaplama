import { SyncBadge } from '@pazarsync/web';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const States = () => (
  <div className="gap-sm flex flex-col items-start">
    <SyncBadge state="fresh" lastSyncedAt={new Date(Date.now() - 8 * MIN)} source="Trendyol" />
    <SyncBadge state="stale" lastSyncedAt={new Date(Date.now() - 26 * HOUR)} source="Hepsiburada" />
    <SyncBadge state="failed" lastSyncedAt={new Date(Date.now() - 3 * HOUR)} source="Trendyol" />
  </div>
);

export const Syncing = () => (
  <div className="gap-sm flex flex-col items-start">
    <SyncBadge
      state="syncing"
      lastSyncedAt={null}
      source="Trendyol"
      progress={{ current: 340, total: 1200 }}
    />
    <SyncBadge
      state="retrying"
      lastSyncedAt={new Date(Date.now() - 5 * MIN)}
      progress={{ current: 90, total: 500 }}
    />
  </div>
);

export const MultiSync = () => (
  <div className="gap-sm flex flex-col items-start">
    <SyncBadge state="syncing" lastSyncedAt={null} activeCount={3} />
  </div>
);
