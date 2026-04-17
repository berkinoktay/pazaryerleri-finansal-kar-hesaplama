'use client';

import { Copy01Icon, Tick02Icon } from 'hugeicons-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string;
  language?: string;
}

/**
 * Lightweight code-with-copy block for the showcase. No syntax highlighting
 * — we ship readable-enough TSX in a mono font, which is plenty for docs
 * that rarely scroll past 20 lines per snippet.
 */
export function CodeBlock({
  code,
  language = 'tsx',
  className,
  ...props
}: CodeBlockProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Kod panoya kopyalandı');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        'border-border bg-surface-subtle relative overflow-hidden rounded-md border',
        className,
      )}
      {...props}
    >
      <div className="border-border px-sm py-3xs flex items-center justify-between border-b">
        <span className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
          {language}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={handleCopy} aria-label="Kodu kopyala">
          {copied ? (
            <Tick02Icon className="size-icon-xs text-success" />
          ) : (
            <Copy01Icon className="size-icon-xs" />
          )}
        </Button>
      </div>
      <pre className="p-sm overflow-x-auto">
        <code className="text-foreground font-mono text-xs leading-relaxed">{code}</code>
      </pre>
    </div>
  );
}
