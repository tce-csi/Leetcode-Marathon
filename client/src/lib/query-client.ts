import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      // A short shared freshness window dedupes the burst of mount refetches a
      // single navigation can trigger (level + progress + leaderboard). Live
      // screens still poll via their own refetchInterval, and cross-tab changes
      // force invalidation, so data stays fresh without duplicate requests.
      staleTime: 15_000,
      gcTime: 5 * 60_000,
    },
  },
});
