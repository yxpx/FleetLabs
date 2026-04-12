import { useEffect, useState, useRef, useCallback } from "react";
import { sseUrl } from "@/lib/api";

export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
}

/**
 * Hook to subscribe to backend SSE stream.
 * Returns the latest events array and a reconnect function.
 */
export function useAgentStream(path = "/orchestrator/events") {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(sseUrl(path));
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (msg) => {
      try {
        const parsed: AgentEvent = JSON.parse(msg.data);
        setEvents((prev) => [parsed, ...prev].slice(0, 100));
      } catch {
        // skip malformed messages
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // auto-reconnect after 5s
      setTimeout(connect, 5000);
    };
  }, [path]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
    };
  }, [connect]);

  return { events, connected };
}
