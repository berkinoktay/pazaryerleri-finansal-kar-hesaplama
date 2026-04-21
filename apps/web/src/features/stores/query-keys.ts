export const storeKeys = {
  all: ['stores'] as const,
  lists: () => [...storeKeys.all, 'list'] as const,
  list: (orgId: string) => [...storeKeys.lists(), orgId] as const,
  details: () => [...storeKeys.all, 'detail'] as const,
  detail: (orgId: string, storeId: string) => [...storeKeys.details(), orgId, storeId] as const,
};
