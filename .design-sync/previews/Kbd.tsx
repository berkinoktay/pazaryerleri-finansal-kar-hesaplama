import { Kbd, KbdGroup } from '@pazarsync/web';

export const Shortcut = () => (
  <div className="gap-md flex items-center">
    <KbdGroup>
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
    <Kbd>Esc</Kbd>
  </div>
);
