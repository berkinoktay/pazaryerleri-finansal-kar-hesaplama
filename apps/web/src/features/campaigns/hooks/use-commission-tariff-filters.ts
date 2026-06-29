'use client';

import { useQueryStates } from 'nuqs';

import { commissionTariffFiltersParsers } from '../lib/commission-tariff-filters';

export function useCommissionTariffFilters() {
  const [filters, setFilters] = useQueryStates(commissionTariffFiltersParsers, {
    history: 'push',
  });
  return { filters, setFilters };
}
