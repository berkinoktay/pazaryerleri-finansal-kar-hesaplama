import { Spinner } from '@pazarsync/web';

export const Sizes = () => (
  <div className="gap-md flex items-center">
    <Spinner size="sm" />
    <Spinner size="md" />
    <Spinner size="lg" />
  </div>
);

export const Tones = () => (
  <div className="gap-md flex items-center">
    <Spinner tone="primary" />
    <Spinner tone="success" />
    <Spinner tone="info" />
  </div>
);
