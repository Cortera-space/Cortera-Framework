"use client";

import React, { useState, useEffect, useCallback } from "react";

export interface ContainedActorsPanelProps {
  workspaceId: string;
  basePath?: string;
  currentActorId?: string;
}

export function ContainedActorsPanel({
  workspaceId,
  basePath = "",
  currentActorId = "human-reviewer",
}: ContainedActorsPanelProps) {
  const [actors, setActors] = useState<
    Array<{
      actorId: string;
      workspaceId: string;
      status: string;
      containedAt: string | null;
      containedReason: string | null;
      reviewedBy: string | null;
      reviewedAt: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${basePath}/traces/actors/contained?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch contained actors: ${res.statusText}`);
      }
      const data = await res.json();
      setActors(data.actors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, basePath]);

  useEffect(() => {
    fetchActors();
  }, [workspaceId, basePath, fetchActors]);

  const handleDecision = async (actorId: string, decision: "lift" | "revoke") => {
    setError(null);
    try {
      const res = await fetch(`/actors/${encodeURIComponent(actorId)}/review?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ decision, reviewerActorId: currentActorId }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Request failed: ${res.statusText}`);
      }
      await fetchActors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h2>Contained Actors</h2>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {loading && <p>Loading...</p>}
      {!loading && actors.length === 0 && <p>No contained actors.</p>}
      {actors.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #ddd",
          }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Actor ID</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Contained At</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Reason</th>
              <th style={{ textAlign: "left", padding: "0.5rem", border: "1px solid #ddd" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {actors.map((actor) => (
              <tr key={`${actor.actorId}:${actor.workspaceId}`} style={{ background: "#fff0f0" }}>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  {actor.actorId}
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      background: "#dc2626",
                      color: "#fff",
                      padding: "0.1rem 0.4rem",
                      borderRadius: "0.25rem",
                      fontWeight: "bold",
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                    }}
                  >
                    CONTAINED
                  </span>
                </td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  {actor.containedAt ? new Date(actor.containedAt).toLocaleString() : "—"}
                </td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>{actor.containedReason || "—"}</td>
                <td style={{ padding: "0.5rem", border: "1px solid #ddd" }}>
                  <button
                    type="button"
                    onClick={() => handleDecision(actor.actorId, "lift")}
                    style={{ marginRight: "0.5rem", padding: "0.25rem 0.5rem" }}
                  >
                    Lift
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecision(actor.actorId, "revoke")}
                    style={{ padding: "0.25rem 0.5rem" }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
