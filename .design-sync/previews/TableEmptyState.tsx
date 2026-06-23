import { TableEmptyState, TableNoResultsState, TableErrorState } from '@pazarsync/web';

export const Empty = () => (
  <div className="max-w-modal w-full">
    <TableEmptyState />
  </div>
);

export const NoResults = () => (
  <div className="max-w-modal w-full">
    <TableNoResultsState />
  </div>
);

export const ErrorState = () => (
  <div className="max-w-modal w-full">
    <TableErrorState onRetry={() => {}} />
  </div>
);
