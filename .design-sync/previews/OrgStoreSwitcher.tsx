import { OrgStoreSwitcher } from '@pazarsync/web';

const ORGS = [{ id: 'o1', name: 'Oktay Ticaret' }];
const STORES = [
  { id: 's1', name: 'Trendyol — Ana Mağaza', platform: 'TRENDYOL', organizationId: 'o1' },
  { id: 's2', name: 'Trendyol — Outlet', platform: 'TRENDYOL', organizationId: 'o1' },
  { id: 's3', name: 'Hepsiburada', platform: 'HEPSIBURADA', organizationId: 'o1' },
];

export const Default = () => (
  <div className="max-w-sheet w-full">
    <OrgStoreSwitcher
      orgs={ORGS}
      stores={STORES}
      activeOrgId="o1"
      activeStoreId={null}
      onSelectOrg={() => {}}
      onSelectStore={() => {}}
      onAddStore={() => {}}
    />
  </div>
);
