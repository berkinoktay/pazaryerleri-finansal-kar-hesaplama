// Curated hugeicons re-export, merged onto window.PazarSyncDS via cfg.extraEntries.
// Preview .tsx files import these from '@pazarsync/web' instead of from
// 'hugeicons-react' directly: importing the 4000-export hugeicons module inside
// the preview-compile path hangs esbuild, while the main bundle tree-shakes the
// same few named icons in milliseconds. Add an icon here when a preview needs it.
export {
  RefreshIcon,
  Tick02Icon,
  Delete02Icon,
  Store01Icon,
  InboxIcon,
  PackageIcon,
  Search01Icon,
  ShoppingBag01Icon,
} from 'hugeicons-react';
