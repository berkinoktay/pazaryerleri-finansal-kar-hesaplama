import { Slider } from '@pazarsync/web';

export const Default = () => (
  <div className="max-w-form w-full">
    <Slider defaultValue={[35]} max={100} step={1} />
  </div>
);

export const Range = () => (
  <div className="max-w-form w-full">
    <Slider defaultValue={[20, 80]} max={100} step={1} />
  </div>
);
