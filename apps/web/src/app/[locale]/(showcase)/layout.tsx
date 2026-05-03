import Link from 'next/link';

import { Wordmark } from '@/components/brand/wordmark';
import { ThemeToggle } from '@/components/showcase/theme-toggle';
import { Separator } from '@/components/ui/separator';

const SHOWCASE_NAV = [
  { href: '/design', label: 'Genel' },
  { href: '/design/tokens', label: 'Token' },
  { href: '/design/primitives', label: 'Primitive' },
  { href: '/design/patterns', label: 'Pattern' },
  { href: '/design/data', label: 'Veri' },
  { href: '/design/layout-demo', label: 'Layout' },
  { href: '/design/manifest', label: 'Manifest' },
  { href: '/design/checklist', label: 'Checklist' },
];

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border bg-background/90 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="max-w-content-max gap-lg px-lg py-sm mx-auto flex items-center">
          <Link href="/design" className="focus-visible:outline-none">
            <Wordmark />
          </Link>
          <span className="border-border bg-muted px-xs py-3xs text-2xs text-muted-foreground rounded-full border font-medium tracking-wide uppercase">
            Design System
          </span>
          <nav aria-label="Showcase" className="gap-3xs ml-auto flex items-center">
            {SHOWCASE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-sm py-3xs text-muted-foreground duration-fast hover:bg-muted hover:text-foreground rounded-md text-sm font-medium transition-colors focus-visible:outline-none"
              >
                {item.label}
              </Link>
            ))}
            <Separator orientation="vertical" className="mx-xs h-6" />
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="max-w-content-max gap-2xl px-lg py-2xl mx-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
