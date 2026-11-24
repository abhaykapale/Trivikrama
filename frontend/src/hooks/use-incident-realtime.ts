"use client";

import { useEffect, useRef, useState } from "react";
import {
  incidentWebSocket,
  type IncidentNotification,
  type RealtimeConnectionStatus,
} from "@/services/websocket/incident-websocket";

export function useIncidentRealtime(onNotification: (notification: IncidentNotification) => void) {
  const callback = useRef(onNotification);
  const debounceTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<RealtimeConnectionStatus>("disconnected");

  useEffect(() => {
    callback.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    const unsubscribeNotification = incidentWebSocket.subscribe((notification) => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => callback.current(notification), 500);
    });
    const unsubscribeStatus = incidentWebSocket.subscribeStatus(setStatus);

    return () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
      unsubscribeNotification();
      unsubscribeStatus();
    };
  }, []);

  return status;
}
