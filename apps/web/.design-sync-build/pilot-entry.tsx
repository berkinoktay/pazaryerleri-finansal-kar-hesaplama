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

// Wave 3b — overlay + interactive + pattern flows
export * from '@/components/ui/alert-dialog';
export * from '@/components/ui/hover-card';
export * from '@/components/ui/sheet';
export * from '@/components/ui/drawer';
export * from '@/components/ui/command';
export * from '@/components/ui/input-otp';
export * from '@/components/patterns/stepper';
export * from '@/components/patterns/inline-edit';
export * from '@/components/patterns/file-upload';
export * from '@/components/patterns/bottom-dock';
export * from '@/components/patterns/wizard';

// Wave 4 — charts (recharts)
export * from '@/components/patterns/chart-bar';
export * from '@/components/patterns/chart-line';
export * from '@/components/patterns/chart-donut';
export * from '@/components/patterns/chart-ranking';
export * from '@/components/patterns/chart-combo';
export * from '@/components/patterns/sparkline';
export * from '@/components/patterns/distribution-bar';
export * from '@/components/patterns/chart-period-selector';

// Wave 5 — next/* + remaining flows
export * from '@/components/patterns/stat-card';
export * from '@/components/patterns/multi-file-upload';
export * from '@/components/ui/form';
export * from '@/components/ui/menubar';

// Wave 6 — feature/query group (controlled, no internal fetch)
export * from '@/components/patterns/data-table';
export * from '@/components/patterns/filter-tabs';

// Wave 7 — simple primitives + patterns
export * from '@/components/ui/label';
export * from '@/components/ui/textarea';
export * from '@/components/ui/slider';
export * from '@/components/ui/toggle';
export * from '@/components/ui/toggle-group';
export * from '@/components/ui/radio-group';
export * from '@/components/ui/alert';
export * from '@/components/ui/breadcrumb';
export * from '@/components/ui/pagination';
export * from '@/components/ui/kbd';
export * from '@/components/ui/select';
export * from '@/components/ui/aspect-ratio';
export * from '@/components/patterns/search-input';
export * from '@/components/patterns/money-input';
export * from '@/components/patterns/percentage-input';
export * from '@/components/patterns/page-header';

// Wave 8 — remaining surface (display, domain, overlay, feature)
export * from '@/components/patterns/activity-feed';
export * from '@/components/patterns/stat-group';
export * from '@/components/patterns/identity-cell';
export * from '@/components/patterns/unmatched-variant-badge';
export * from '@/components/patterns/chart-frame';
export * from '@/components/ui/range-input';
export * from '@/components/ui/soft-square-icon';
export * from '@/components/patterns/filter-chip-group';
export * from '@/components/patterns/nav-group';
export * from '@/components/patterns/bulk-action-bar';
export * from '@/components/patterns/rail-warning-card';
export * from '@/components/patterns/notification-bell';
export * from '@/components/patterns/date-input';
export * from '@/components/patterns/theme-toggle-inline';
export * from '@/components/patterns/profit-breakdown';
export * from '@/components/patterns/promotion-indicator';
export * from '@/components/patterns/badge-with-overflow';
export * from '@/components/patterns/combobox';
export * from '@/components/ui/calendar';
export * from '@/components/patterns/date-range-picker';
export * from '@/components/patterns/info-hint';
export * from '@/components/patterns/confirm-dialog';
export * from '@/components/ui/image-modal';
export * from '@/components/patterns/image-cell';
export * from '@/components/patterns/data-table-states';
export * from '@/components/ui/sidebar';
export * from '@/components/patterns/org-store-switcher';
export * from '@/components/ui/navigation-menu';

export { PreviewProvider } from './preview-provider';
