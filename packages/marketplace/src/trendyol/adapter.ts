import { ValidationError } from '@pazarsync/sync-core';

import type { MarketplaceAdapter, MarketplaceAdapterFactory } from '../types';

import { probeTrendyolCredentials } from './client';
import { checkPriceBatchStatus, updatePrices } from './prices';
import { isTrendyolCredentials, type TrendyolCredentials } from './types';

function narrowCredentials(value: unknown): TrendyolCredentials {
  if (!isTrendyolCredentials(value)) {
    throw new ValidationError([{ field: 'credentials', code: 'INVALID_CREDENTIALS_SHAPE' }]);
  }
  return value;
}

export const trendyolFactory: MarketplaceAdapterFactory = {
  platform: 'TRENDYOL',
  supportedEnvironments: ['PRODUCTION', 'SANDBOX'],
  create({ environment, credentials }): MarketplaceAdapter {
    const cred = narrowCredentials(credentials);
    return {
      async testConnection() {
        await probeTrendyolCredentials(cred, environment);
        return { externalAccountId: cred.supplierId };
      },

      async updatePrices(items) {
        return updatePrices({ credentials: cred, environment, items });
      },

      async checkPriceBatch(batchId) {
        return checkPriceBatchStatus({ credentials: cred, environment, batchId });
      },
    };
  },
};
