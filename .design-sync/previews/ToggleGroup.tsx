import { ToggleGroup, ToggleGroupItem } from '@pazarsync/web';

export const SingleSelect = () => (
  <ToggleGroup type="single" defaultValue="liste">
    <ToggleGroupItem value="liste">Liste</ToggleGroupItem>
    <ToggleGroupItem value="tablo">Tablo</ToggleGroupItem>
    <ToggleGroupItem value="kart">Kart</ToggleGroupItem>
  </ToggleGroup>
);
