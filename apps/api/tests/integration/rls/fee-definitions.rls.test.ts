import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createFeeDefinition } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * fee_definitions: global reference table — pazaryeri × feeType başına 1 satır,
 * tüm seller'lara aynı kural. RLS: `USING (true)` SELECT açık; INSERT/UPDATE/
 * DELETE policy YOK → authenticated rolü için default-deny.
 *
 * Aynı pattern: fx_rates, shipping_carriers, shipping_desi_tariffs,
 * marketplace_commission_rate.
 *
 * Seed (PR-2'de) Trendyol için 4 satır ekler. PR-1'de seed yok — bu test'ler
 * factory ile fixture yaratıp izolasyon davranışını doğrular.
 */
describe('RLS — fee_definitions', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('authenticated user reads ALL fee_definitions (global reference)', async () => {
    const { client } = await createRlsScopedClient();
    await Promise.all([
      createFeeDefinition({ feeType: 'PLATFORM_SERVICE', fixedAmountNet: '10.99' }),
      createFeeDefinition({
        feeType: 'STOPPAGE',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: '0.0100',
        fixedAmountNet: undefined,
        defaultVatRate: '0.00',
        effectiveFrom: new Date('2026-01-02'),
      }),
    ]);

    const { data, error } = await client.from('fee_definitions').select('id,fee_type');

    expect(error).toBeNull();
    expect(data?.length).toBe(2);
  });

  it('authenticated user cannot INSERT into fee_definitions (default-deny)', async () => {
    const { client } = await createRlsScopedClient();

    const { data, error } = await client
      .from('fee_definitions')
      .insert({
        platform: 'TRENDYOL',
        fee_type: 'CUSTOM',
        display_name: 'Hack',
        calculation_kind: 'FIXED',
        fixed_amount_net: '99.99',
        default_vat_rate: '20.00',
        effective_from: '2026-01-01T00:00:00Z',
      })
      .select();

    // Policy default-deny: 0 satır INSERT edilir, error veya empty data döner.
    // RLS WITH CHECK olmadığı için bazı PostgREST sürümleri error yerine boş array döner.
    // Her durumda: tabloda yeni row YOK.
    expect(data === null || data.length === 0).toBe(true);
    if (error !== null) {
      // RLS reddetmesi error olarak gelirse mesaj "row-level security" geçer.
      expect(error.message.toLowerCase()).toMatch(/row-level security|permission|policy/);
    }
  });
});
