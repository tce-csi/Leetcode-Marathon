import { useEffect, useRef } from "react";

/**
 * Polls a data-loading callback on an interval, throttled by tab visibility.
 *
 * - The interval ticks are skipped while the tab is hidden (browsers already
 *   throttle timers, but skipping avoids wasted network calls).
 * - Refreshing on focus and on `visibilitychange` covers the cases where the
 *   user returns to the tab after the interval last ticked.
 * - The callback is kept in a ref so callers never need to re-run the effect.
 */
export function useAutoRefresh(refresh: () => void | Promise<void>, intervalMs?: number | null): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) return;

    const invoke = () => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current();
    };

    const timer = window.setInterval(invoke, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") invoke();
    };
    window.addEventListener("focus", invoke);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", invoke);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}