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

export { PreviewProvider } from './preview-provider';
