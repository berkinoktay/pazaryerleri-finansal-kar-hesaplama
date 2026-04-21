'use client';

import { ErrorFallback } from '@/components/common/error-fallback';

export default function AuthSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return <ErrorFallback error={error} reset={reset} />;
}
