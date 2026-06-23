import { Progress } from '@pazarsync/web';

export const Values = () => (
  <div className="gap-md max-w-input flex w-full flex-col">
    <Progress value={30} />
    <Progress value={70} />
    <Progress value={100} tone="success" />
  </div>
);

export const Tones = () => (
  <div className="gap-md max-w-input flex w-full flex-col">
    <Progress value={60} tone="success" />
    <Progress value={45} tone="warning" />
    <Progress value={20} tone="destructive" />
  </div>
);

export const Indeterminate = () => (
  <div className="max-w-input w-full">
    <Progress value={null} />
  </div>
);
