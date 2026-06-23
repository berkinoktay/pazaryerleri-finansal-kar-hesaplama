import { AspectRatio } from '@pazarsync/web';

export const Ratio16x9 = () => (
  <div className="w-80">
    <AspectRatio ratio={16 / 9}>
      <div className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-md text-sm">
        16 : 9
      </div>
    </AspectRatio>
  </div>
);
