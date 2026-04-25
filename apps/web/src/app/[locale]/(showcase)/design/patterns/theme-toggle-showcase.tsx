import { ThemeToggleInline } from '@/components/patterns/theme-toggle-inline';

export function ThemeToggleShowcase(): React.ReactElement {
  return (
    <div className="border-border bg-card p-md rounded-md border" style={{ width: 240 }}>
      <ThemeToggleInline />
    </div>
  );
}
