// design-sync bundle entry (pilot scope). esbuild bundles this into
// _ds_bundle.js, assigning every re-export to window.PazarSyncDS.*. Kept tightly
// scoped to the pilot components so the whole Next.js app isn't dragged in.
// `@/…` resolves via apps/web/tsconfig.json paths (tsconfigPathsPlugin).
export * from '@/components/ui/button';
export * from '@/components/ui/badge';
export * from '@/components/ui/card';
export * from '@/components/ui/input';

export * from '@/components/patterns/currency';
export * from '@/components/patterns/empty-state';
export * from '@/components/patterns/trend-delta';
export * from '@/components/patterns/mapped-badge';
export * from '@/components/patterns/sync-badge';
export * from '@/components/patterns/time-ago';
export * from '@/components/patterns/copyable-value';
export * from '@/components/patterns/stat-strip';

// Wave 2a — pure primitives + composites
export * from '@/components/ui/avatar';
export * from '@/components/ui/checkbox';
export * from '@/components/ui/switch';
export * from '@/components/ui/progress';
export * from '@/components/ui/skeleton';
export * from '@/components/ui/spinner';
export * from '@/components/ui/separator';
export * from '@/components/ui/status-dot';
export * from '@/components/ui/table';
export * from '@/components/ui/count-badge';
export * from '@/components/patterns/stat-row';
export * from '@/components/patterns/profit-cell';
export * from '@/components/patterns/banner';
export * from '@/components/patterns/definition-list';

// Wave 3a — overlay + interactive primitives
export * from '@/components/ui/tabs';
export * from '@/components/ui/accordion';
export * from '@/components/ui/collapsible';
export * from '@/components/ui/scroll-area';
export * from '@/components/ui/tooltip';
export * from '@/components/ui/popover';
export * from '@/components/ui/dropdown-menu';
export * from '@/components/ui/dialog';

export { PreviewProvider } from './preview-provider';
