import type { components } from '@pazarsync/api-client';

/**
 * Generated API types re-exported under feature-local names (mirrors
 * features/shipping/types). `ProfitSettings` is the resolved (default-applied)
 * shape returned by both GET and PATCH; `UpdateProfitSettingsInput` is the
 * partial PATCH body (all keys optional — shallow-merged on the backend).
 */
export type ProfitSettings = components['schemas']['ProfitSettings'];
export type UpdateProfitSettingsInput = components['schemas']['UpdateProfitSettingsInput'];
