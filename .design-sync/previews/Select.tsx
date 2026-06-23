import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@pazarsync/web';

export const Open = () => (
  <Select defaultValue="trendyol" defaultOpen>
    <SelectTrigger className="w-[220px]">
      <SelectValue placeholder="Mağaza seç" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="trendyol">Trendyol — Ana Mağaza</SelectItem>
      <SelectItem value="trendyol-2">Trendyol — Outlet</SelectItem>
      <SelectItem value="hepsiburada">Hepsiburada</SelectItem>
    </SelectContent>
  </Select>
);
