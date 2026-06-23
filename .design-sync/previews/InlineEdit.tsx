import { InlineEdit } from '@pazarsync/web';

export const Display = () => (
  <div className="gap-md flex flex-col text-sm">
    <InlineEdit value="Trendyol — Ana Mağaza" onCommit={() => {}} ariaLabel="Mağaza adı" />
    <InlineEdit
      value="42,50"
      onCommit={() => {}}
      ariaLabel="Birim maliyet"
      renderDisplay={(v) => <span className="tabular-nums">₺{v}</span>}
    />
  </div>
);
