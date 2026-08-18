import { useQueries } from "@tanstack/react-query";
import {
  getHouseholdMeterState,
  getGetHouseholdMeterStateQueryKey,
  type HouseholdMeterState,
} from "@workspace/api-client-react";

export interface MeterStateResult {
  assetId: string;
  state: HouseholdMeterState | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Progressively load device state for a set of meters (the visible page only).
 * Results are cached under the same query keys the detail view uses.
 */
export function useMeterStates(assetIds: string[], staleMs = 60_000): MeterStateResult[] {
  const queries = useQueries({
    queries: assetIds.map((id) => ({
      queryKey: getGetHouseholdMeterStateQueryKey(id),
      queryFn: () => getHouseholdMeterState(id),
      staleTime: staleMs,
      // Keep visible-page states live (paused automatically when tab hidden).
      refetchInterval: 90_000,
      retry: 1,
    })),
  });
  return assetIds.map((assetId, i) => ({
    assetId,
    state: queries[i]?.data,
    isLoading: queries[i]?.isLoading ?? false,
    isError: queries[i]?.isError ?? false,
  }));
}
