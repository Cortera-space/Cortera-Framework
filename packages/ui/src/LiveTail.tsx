"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

export interface LiveTailProps {
  workspaceId: string;
  filters?: { actorId?: string; actionName?: string };
  basePath?: string;
}

interface LiveEvent {
  event_id: string;
  action_name: string;
  actor_type: string;
  actor_id: string;
  permission_result: string;
  status: string;
  input: unknown;
  output: unknown | null;
  error: unknown | null;
  parent_event_id: string | null;
  started_at: string;
  duration_ms: number | null;
  workspace_id: string;
  blast_radius: string[] | null;
  created_at: string;
  updated_at: string;
}

function isContained(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as Record<string, unknown>).code === "BLAST_RADIUS_EXCEEDED";
}

function permissionColor(result: string): string {
  if (result === "allow") return "green";
  if (result === "deny") return "red";
  return "orange";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function buildQueryString(workspaceId: string, filters?: { actorId?: string; actionName?: string }): string {
  const params = new URLSearchParams();
  params.set("workspaceId", workspaceId);
  if (filters?.actorId) params.set("actorId", filters.actorId);
  if (filters?.actionName) params.set("actionName", filters.actionName);
  return params.toString();
}

export function LiveTail({ workspaceId, filters, basePath = "" }: LiveTailProps) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (typeof EventSource === "undefined") {
      setError("EventSource not available in this environment");
      return;
    }

    const url = `${basePath}/live-tail?${buildQueryString(workspaceId, filters)}`;
    const source = new EventSource(url);
    eventSourceRef.current = source;
    setReconnecting(false);
    setError(null);

    source.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as LiveEvent;
        setEvents((prev) => [...prev, data]);
      } catch {
        /* ignore non-JSON messages */
      }
    });

    source.addEventListener("error", () => {
      source.close();
      eventSourceRef.current = null;
      setReconnecting(true);

      const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current += 1;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectAttemptRef.current = 0;
        setReconnecting(false);
        connect();
      }, backoff);
    });
  }, [workspaceId, filters, basePath]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect]);

  useEffect(() => {
    if (!paused && eventsEndRef.current && typeof eventsEndRef.current.scrollIntoView === "function") {
      eventsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, paused]);

  const handlePauseToggle = () => setPaused((p) => !p);

  const handleRowClick = (eventId: string) => {
    window.location.href = `${basePath}/traces/${eventId}?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <h2 style={{ margin: 0 }}>Live Tail</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {reconnecting && (
            <span style={{ color: "#dc2626", fontWeight: "bold" }}>
              Reconnecting…
            </span>
          )}
          <button
            type="button"
            onClick={handlePauseToggle}
            style={{ padding: "0.5rem 1rem" }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: "red" }}>Error: {error}</p>
      )}

      <div
        style={{
          maxHeight: "600px",
          overflowY: "auto",
          border: "1px solid #ddd",
          borderRadius: "0.25rem",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f5f5f5", position: "sticky", top: 0 }}>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Timestamp</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Action</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Actor</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Result</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && !reconnecting && (
              <tr>
                <td colSpan={5} style={{ padding: "1rem", textAlign: "center", color: "#999" }}>
                  Waiting for events…
                </td>
              </tr>
            )}
            {events.map((evt) => {
              const contained = isContained(evt.error);
              return (
                <tr
                  key={evt.event_id}
                  onClick={() => handleRowClick(evt.event_id)}
                  style={{
                    cursor: "pointer",
                    background: contained ? "#fff0f0" : "transparent",
                    borderLeft: contained ? "4px solid #dc2626" : "1px solid #ddd",
                  }}
                >
                  <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                    {formatDate(evt.started_at)}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                    {evt.action_name}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                    {evt.actor_type}:{evt.actor_id}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                    {contained ? (
                      <span
                        style={{
                          background: "#dc2626",
                          color: "#fff",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "0.25rem",
                          fontWeight: "bold",
                          fontSize: "0.85rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        CONTAINED
                      </span>
                    ) : (
                      <span
                        style={{
                          color: permissionColor(evt.permission_result),
                          fontWeight: "bold",
                        }}
                      >
                        {evt.permission_result}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                    {evt.duration_ms !== null ? `${evt.duration_ms}ms` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paused && (
        <p style={{ textAlign: "center", color: "#999", marginTop: "0.5rem" }}>
          Paused — {events.length} events
        </p>
      )}

      <div ref={eventsEndRef} />
    </div>
  );
}
