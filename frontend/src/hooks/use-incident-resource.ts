"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/types/api";

export function useIncidentResource<T>(enabled: boolean, requestKey: string, loader: (signal: AbortSignal) => Promise<T>) {
  const loaderRef = useRef(loader);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState<{ readonly data: T | null; readonly loading: boolean; readonly refreshing: boolean; readonly error: string | null }>({ data: null, loading: enabled, refreshing: false, error: null });
  const [previousRequest, setPreviousRequest] = useState({ enabled, requestKey, refreshVersion });
  if (previousRequest.enabled !== enabled || previousRequest.requestKey !== requestKey || previousRequest.refreshVersion !== refreshVersion) {
    setPreviousRequest({ enabled, requestKey, refreshVersion });
    if (enabled) {
      setState((current) => ({ ...current, loading: current.data === null, refreshing: current.data !== null, error: null }));
    }
  }
  useEffect(() => { loaderRef.current = loader; }, [loader]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loaderRef.current(controller.signal).then((data) => { if (!controller.signal.aborted) setState({ data, loading: false, refreshing: false, error: null }); }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : "This incident section could not be loaded.";
      setState((current) => ({ ...current, loading: false, refreshing: false, error: message }));
    });
    return () => controller.abort();
  }, [enabled, requestKey, refreshVersion]);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  return { ...state, refresh };
}
