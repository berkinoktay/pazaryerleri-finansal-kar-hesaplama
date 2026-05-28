export const membersKeys = {
  all: ['members'] as const,
  lists: () => [...membersKeys.all, 'list'] as const,
  list: (orgId: string) => [...membersKeys.lists(), orgId] as const,
};
