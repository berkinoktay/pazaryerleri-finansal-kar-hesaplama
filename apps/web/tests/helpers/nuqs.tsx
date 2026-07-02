import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import * as React from 'react';

/**
 * nuqs testing harness for INTERACTIVE tests. Without `hasMemory` the
 * adapter freezes `searchParams` at the initial value: an update is served
 * optimistically, but any LATER re-render (e.g. a React Query key change
 * refetching) re-reads the frozen value and silently reverts the URL state —
 * the clicked tab appears to "un-click". `hasMemory` makes the adapter
 * behave like a real one; `rateLimitFactor={0}` keeps updates synchronous so
 * no throttle timer outlives the test (the CI teardown crash class).
 */
export function NuqsTestHarness({
  children,
  initialSearchParams = '',
}: {
  children: React.ReactNode;
  initialSearchParams?: string;
}): React.ReactElement {
  return (
    <NuqsTestingAdapter searchParams={initialSearchParams} rateLimitFactor={0} hasMemory>
      {children}
    </NuqsTestingAdapter>
  );
}
