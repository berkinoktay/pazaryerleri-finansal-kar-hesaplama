import { Skeleton } from '@pazarsync/web';

export const Lines = () => (
  <div className="gap-sm max-w-input flex w-full flex-col">
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <Skeleton className="h-4 w-1/2" />
  </div>
);

export const MediaObject = () => (
  <div className="gap-sm flex items-center">
    <Skeleton className="size-12 rounded-full" />
    <div className="gap-2xs flex flex-col">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-24" />
    </div>
  </div>
);
