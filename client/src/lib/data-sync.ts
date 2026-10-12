/**
 * Cross-tab data synchronisation.
 *
 * Whenever a mutation succeeds (any non-GET request), the API client broadcasts
 * a change so every open tab - including the tab that performed the mutation -
 * refreshes the relevant queries. TanStack Query's default coalescing prevents
 * wasteful duplicate refetches, and the listener invalidates background groups
 * only, so active forms are never clobbered mid-edit.
 */
import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/query-client";

const CHANNEL_NAME = "codequest:data-change";
const EVENT_NAME = "cq:data-changed";

export type SyncAudience = "student" | "admin";

interface ChangeMessage {
  audience: SyncAudience;
  at: number;
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function notifyDataChanged(audience: SyncAudience): void {
  const message: ChangeMessage = { audience, at: Date.now() };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ChangeMessage>(EVENT_NAME, { detail: message }));
  }
  const broadcast = getChannel();
  if (broadcast) {
    try {
      broadcast.postMessage(message);
    } catch {
      // ignore – the same-tab event above still triggers a refresh
    }
  }
}

export function subscribeDataChanged(handler: (audience: SyncAudience) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<ChangeMessage>).detail;
    if (detail?.audience) handler(detail.audience);
  };
  const onMessage = (event: MessageEvent<ChangeMessage>) => {
    if (event.data?.audience) handler(event.data.audience);
  };
  window.addEventListener(EVENT_NAME, onEvent);
  const broadcast = getChannel();
  broadcast?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(EVENT_NAME, onEvent);
    broadcast?.removeEventListener("message", onMessage);
  };
}

const COOLDOWN_MS = 200;

/** Global listener mounted once per app that refreshes queries on data changes. */
export function DataSyncListener(): null {
  const lastFired = useRef<Partial<Record<SyncAudience, number>>>({});

  useEffect(() => {
    return subscribeDataChanged((audience) => {
      const now = Date.now();
      if (lastFired.current[audience] !== undefined && now - (lastFired.current[audience] ?? 0) < COOLDOWN_MS) {
        return;
      }
      lastFired.current[audience] = now;
      // Invalidate background groups so visible data refreshes immediately while
      // any in-progress admin forms keep their local state.
      if (audience === "admin") {
        queryClient.invalidateQueries({ queryKey: ["admin"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["student"] });
      }
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    });
  }, []);

  return null;
}