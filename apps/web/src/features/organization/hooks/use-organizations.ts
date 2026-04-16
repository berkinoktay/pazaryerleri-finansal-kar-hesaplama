import { useQuery } from "@tanstack/react-query";

import { listOrganizations, type Organization } from "../api/organizations.api";
import { organizationKeys } from "../query-keys";

/**
 * Lists organizations the authenticated user is a member of.
 *
 * NOTE: consumers of this hook must be rendered under a
 * `<QueryClientProvider>` higher in the tree. QueryClient setup is
 * intentionally not handled here — tracked as the next plan's scope.
 */
export function useOrganizations() {
  return useQuery<Organization[]>({
    queryKey: organizationKeys.list(),
    queryFn: listOrganizations,
  });
}
