"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";

export interface TraceListProps {
  workspaceId: string;
  basePath?: string;
}

function isContained(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const obj = error as Record<string, unknown>;
  return obj.code === "BLAST_RADIUS_EXCEEDED";
}

export function TraceList({ workspaceId, basePath = "" }: TraceListProps) {
  const [events, setEvents] = useState<
    Array<{
      eventId: string;
      actionName: string;
      actorType: string;
      actorId: string;
      permissionResult: string;
      startedAt: string;
      durationMs: number | null;
      error: unknown;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<{ startedAt: string; id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const [actorType, setActorType] = useState("");
  const [actionName, setActionName] = useState("");
  const [permissionResult, setPermissionResult] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchEvents = useCallback(
    async (cursor?: { startedAt: string; id: string }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("workspaceId", workspaceId);
        if (actorType) params.set("actorType", actorType);
        if (actionName) params.set("actionName", actionName);
        if (permissionResult) params.set("permissionResult", permissionResult);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (cursor) {
          params.set("cursorStartedAt", cursor.startedAt);
          params.set("cursorId", cursor.id);
        }

        const res = await fetch(`${basePath}/traces?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch events: ${res.statusText}`);
        }
        const data = await res.json();
        const newEvents = cursor ? [...eventsRef.current, ...data.events] : data.events;
        setEvents(newEvents);
        setNextCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, actorType, actionName, permissionResult, from, to, basePath]
  );

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setHasMore(false);
    fetchEvents();
  }, [workspaceId, actorType, actionName, permissionResult, from, to, basePath, fetchEvents]);

  const handleLoadMore = () => {
    if (nextCursor && hasMore && !loading) {
      fetchEvents(nextCursor);
    }
  };

  const handleRowClick = (eventId: string) => {
    window.location.href = `${basePath}/traces/${eventId}?workspaceId=${encodeURIComponent(workspaceId)}`;
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h2>Trace List</h2>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <label>
          Actor Type:
          <select
            value={actorType}
            onChange={(e) => setActorType(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          >
            <option value="">All</option>
            <option value="human">human</option>
            <option value="agent">agent</option>
            <option value="system">system</option>
          </select>
        </label>

        <label>
          Action Name:
          <input
            type="text"
            value={actionName}
            onChange={(e) => setActionName(e.target.value)}
            placeholder="e.g. createNote"
            style={{ marginLeft: "0.5rem" }}
          />
        </label>

        <label>
          Result:
          <select
            value={permissionResult}
            onChange={(e) => setPermissionResult(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          >
            <option value="">All</option>
            <option value="allow">allow</option>
            <option value="deny">deny</option>
            <option value="approval_required">approval_required</option>
          </select>
        </label>

        <label>
          From:
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>

        <label>
          To:
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ marginLeft: "0.5rem" }}
          />
        </label>
      </div>

      {loading && events.length === 0 && <p>Loading...</p>}

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          border: "1px solid #ddd",
        }}
      >
        <thead>
          <tr style={{ background: "#f5f5f5" }}>
            <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Timestamp</th>
            <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Action</th>
            <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Actor</th>
            <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Result</th>
            <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {events.map((evt) => {
            const contained = isContained(evt.error);
            return (
              <tr
                key={evt.eventId}
                onClick={() => handleRowClick(evt.eventId)}
                style={{
                  cursor: "pointer",
                  background: contained ? "#fff0f0" : "transparent",
                  borderLeft: contained ? "4px solid #dc2626" : "1px solid #ddd",
                }}
              >
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  {new Date(evt.startedAt).toLocaleString()}
                </td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>{evt.actionName}</td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  {evt.actorType}:{evt.actorId}
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
                        color:
                          evt.permissionResult === "allow"
                            ? "green"
                            : evt.permissionResult === "deny"
                              ? "red"
                              : "orange",
                        fontWeight: "bold",
                      }}
                    >
                      {evt.permissionResult}
                    </span>
                  )}
                </td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  {evt.durationMs !== null ? `${evt.durationMs}ms` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {events.length === 0 && !loading && <p>No events found.</p>}

      {hasMore && (
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loading}
            style={{ padding: "0.5rem 1rem" }}
          >
            {loading ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}
