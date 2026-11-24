"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIncidentQueue } from "@/services/api/incidents";
import { ApiError } from "@/types/api";
import type { IncidentQueuePage, IncidentQueueQuery } from "@/types/incidents";

interface IncidentQueueState {
  readonly data: IncidentQueuePage | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly lastUpdated: Date | null;
}

export function useIncidentQueue(query: IncidentQueueQuery) {
  const [state, setState] = useState<IncidentQueueState>({ data: null, loading: true, refreshing: false, error: null, lastUpdated: null });
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [previousQuery, setPreviousQuery] = useState(query);
  if (previousQuery !== query) {
    setPreviousQuery(query);
    setState((current) => ({ ...current, data: null, loading: true, refreshing: false, error: null }));
  }

  const load = useCallback(async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const currentSequence = ++sequence.current;

    await getIncidentQueue(query, nextController.signal).then((data) => {
      if (nextController.signal.aborted || currentSequence !== sequence.current) return;
      setState({ data, loading: false, refreshing: false, error: null, lastUpdated: new Date() });
    }).catch((error: unknown) => {
      if (nextController.signal.aborted || currentSequence !== sequence.current) return;
      const message = error instanceof ApiError && error.code !== "REQUEST_CANCELED" ? error.message : "The incident queue could not be loaded.";
      setState((current) => ({ ...current, loading: false, refreshing: false, error: message }));
    });
  }, [query]);

  const refresh = useCallback((clearExisting = false) => {
    setState((current) => ({
      ...current,
      data: clearExisting ? null : current.data,
      loading: clearExisting || current.data === null,
      refreshing: !clearExisting && current.data !== null,
      error: null,
    }));
    return load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  return { ...state, refresh };
}
