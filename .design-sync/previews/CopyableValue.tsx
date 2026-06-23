import { CopyableValue } from '@pazarsync/web';

export const Identifiers = () => (
  <div className="gap-md flex flex-col items-start text-sm">
    <CopyableValue value="8680000123456" label="Barkod">
      <span className="tabular-nums">8680000123456</span>
    </CopyableValue>
    <CopyableValue value="TY-STK-0042" label="Stok Kodu">
      <span className="font-mono">TY-STK-0042</span>
    </CopyableValue>
    <CopyableValue value="11321228951" label="Sipariş No">
      <span className="tabular-nums">Sipariş · 11321228951</span>
    </CopyableValue>
  </div>
);
