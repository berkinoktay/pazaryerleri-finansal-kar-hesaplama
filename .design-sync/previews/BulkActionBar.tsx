import { BulkActionBar, Delete02Icon } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-modal w-full">
    <BulkActionBar
      selectedCount={3}
      onClear={() => {}}
      position="inline"
      actions={[
        { id: 'export', label: 'Dışa aktar', onClick: () => {} },
        {
          id: 'delete',
          label: 'Sil',
          tone: 'destructive',
          icon: <Delete02Icon />,
          onClick: () => {},
        },
      ]}
    />
  </div>
);
