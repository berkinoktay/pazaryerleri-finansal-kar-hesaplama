'use client';

import { Toaster as Sonner } from 'sonner';

import { useTheme } from '@/providers/theme-provider';

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps): React.ReactElement {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-md group-[.toaster]:rounded-md',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-sm',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-sm',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
