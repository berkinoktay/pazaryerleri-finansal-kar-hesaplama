import * as React from 'react';

export interface ProfitBlockerReasonListProps {
  /** Localized reason sentences (`useProfitBlockerReasons`), one per line. */
  reasons: readonly string[];
}

/**
 * Why an order's profit could not be calculated: one sentence per line. Shared by
 * the orders-list badge tooltip and the order-detail alert so both read the same.
 */
export function ProfitBlockerReasonList({
  reasons,
}: ProfitBlockerReasonListProps): React.ReactElement {
  return (
    <ul className="gap-3xs flex flex-col">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}
