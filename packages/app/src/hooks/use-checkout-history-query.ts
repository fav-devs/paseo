import { useQuery } from "@tanstack/react-query";
import type { CheckoutHistoryResponse } from "@server/shared/messages";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type CheckoutHistoryPayload = CheckoutHistoryResponse["payload"];

export function checkoutHistoryQueryKey(serverId: string, cwd: string, limit: number) {
  return ["checkoutHistory", serverId, cwd, limit] as const;
}

export function useCheckoutHistoryQuery({
  serverId,
  cwd,
  limit = 30,
  enabled = true,
}: {
  serverId: string;
  cwd: string;
  limit?: number;
  enabled?: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useQuery({
    queryKey: checkoutHistoryQueryKey(serverId, cwd, limit),
    queryFn: async () => {
      if (!client) {
        throw new Error("Daemon client not available");
      }
      const payload = await client.getCheckoutHistory(cwd, { limit });
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      return payload;
    },
    enabled: enabled && !!client && isConnected && !!cwd,
    staleTime: 15_000,
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: enabled,
    refetchOnMount: "always",
  });

  return {
    history: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refresh: query.refetch,
  };
}
