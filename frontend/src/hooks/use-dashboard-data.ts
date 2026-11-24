"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDashboardSourceBreakdown,
  getDashboardSummary,
  getDashboardTimeline,
  getDashboardTopAssets,
  getRecentIncidents,
} from "@/services/api/dashboard";
import { ApiError } from "@/types/api";
import type { DashboardData, DashboardRange, DashboardSection } from "@/types/dashboard";

const EMPTY_DATA: DashboardData = {
  summary: null,
  timeline: null,
  topAssets: null,
  sources: null,
  incidents: null,
};

interface DashboardState {
  readonly data: DashboardData;
  readonly errors: Partial<Record<DashboardSection, string>>;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly lastUpdated: Date | null;
}

export function useDashboardData(range: DashboardRange) {
  const [state, setState] = useState<DashboardState>({
    data: EMPTY_DATA,
    errors: {},
    loading: true,
    refreshing: false,
    lastUpdated: null,
  });
  const abortController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [previousRange, setPreviousRange] = useState(range);
  if (previousRange !== range) {
    setPreviousRange(range);
    setState((current) => ({ ...current, refreshing: !current.loading }));
  }

  const load = useCallback(async () => {
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    const sequence = ++requestSequence.current;

    const [summary, timeline, topAssets, sources, incidents] = await Promise.allSettled([
      getDashboardSummary(range, controller.signal),
      getDashboardTimeline(range, controller.signal),
      getDashboardTopAssets(range, controller.signal),
      getDashboardSourceBreakdown(range, controller.signal),
      getRecentIncidents(controller.signal),
    ]);

    if (controller.signal.aborted || sequence !== requestSequence.current) return;

    const results = { summary, timeline, topAssets, sources, incidents } as const;
    const errors: Partial<Record<DashboardSection, string>> = {};
    let successfulSections = 0;

    for (const [section, result] of Object.entries(results) as Array<[
      DashboardSection,
      PromiseSettledResult<DashboardData[DashboardSection]>,
    ]>) {
      if (result.status === "fulfilled") successfulSections += 1;
      else errors[section] = describeFailure(result.reason);
    }

    setState((current) => ({
      data: {
        summary: summary.status === "fulfilled" ? summary.value : current.data.summary,
        timeline: timeline.status === "fulfilled" ? timeline.value : current.data.timeline,
        topAssets: topAssets.status === "fulfilled" ? topAssets.value : current.data.topAssets,
        sources: sources.status === "fulfilled" ? sources.value : current.data.sources,
        incidents: incidents.status === "fulfilled" ? incidents.value : current.data.incidents,
      },
      errors,
      loading: false,
      refreshing: false,
      lastUpdated: successfulSections > 0 ? new Date() : current.lastUpdated,
    }));
  }, [range]);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, refreshing: !current.loading }));
    return load();
  }, [load]);

  useEffect(() => {
    void load();
    return () => abortController.current?.abort();
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

function describeFailure(reason: unknown): string {
  if (reason instanceof ApiError) {
    if (reason.code === "REQUEST_CANCELED") return "Request superseded.";
    return reason.message;
  }
  return "This dashboard section could not be loaded.";
}
