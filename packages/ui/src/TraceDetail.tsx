"use client";

import React, { useState, useEffect } from "react";

export interface TraceDetailProps {
  eventId: string;
  workspaceId: string;
  basePath?: string;
}

function isContainedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as Record<string, unknown>).code === "BLAST_RADIUS_EXCEEDED";
}

function getContainedDetails(error: unknown): {
  rootAction: string;
  rootBlastRadius: string[];
  violatingAction: string;
  violatingPermission: string;
} | null {
  if (!isContainedError(error)) return null;
  const obj = error as Record<string, unknown>;
  return {
    rootAction: (obj.rootAction as string) || "",
    rootBlastRadius: (obj.rootBlastRadius as string[]) || [],
    violatingAction: (obj.violatingAction as string) || "",
    violatingPermission: (obj.violatingPermission as string) || "",
  };
}

function renderTreeNode(
  node: { event: Record<string, unknown>; children: { event: Record<string, unknown>; children: unknown[] }[] },
  depth: number
): React.ReactNode {
  const evt = node.event;
  const indent = depth * 20;
  const contained = isContainedError(evt.error);
  const details = contained ? getContainedDetails(evt.error) : null;

  return (
    <div key={evt.eventId as string} style={{ marginLeft: `${indent}px`, marginBottom: "0.75rem" }}>
      <div
        style={{
          padding: "0.5rem",
          border: contained ? "2px solid #dc2626" : "1px solid #ddd",
          background: contained ? "#fff0f0" : "#fafafa",
          borderRadius: "0.25rem",
        }}
      >
        <strong>{evt.actionName as string}</strong>{" "}
        <span style={{ color: "#666" }}>
          ({evt.actorType as string}:{evt.actorId as string})
        </span>
        <span
          style={{
            marginLeft: "0.5rem",
            color:
              evt.permissionResult === "allow"
                ? "green"
                : evt.permissionResult === "deny"
                  ? "red"
                  : "orange",
            fontWeight: "bold",
          }}
        >
          {evt.permissionResult as string}
        </span>
        {contained && (
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
        )}
        <div style={{ fontSize: "0.85rem", color: "#444", marginTop: "0.25rem" }}>
          {new Date(evt.startedAt as string).toLocaleString()}
          {evt.durationMs !== null && ` • ${evt.durationMs as number}ms`}
        </div>
        {details && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.25rem",
              fontSize: "0.85rem",
            }}
          >
            <strong>Containment violation:</strong>{" "}
            <code>{details.violatingAction}</code> (
            <code>{details.violatingPermission}</code>) exceeds blast radius of{" "}
            <code>{details.rootAction}</code> (
            <code>{details.rootBlastRadius.join(", ")}</code>)
          </div>
        )}
      </div>
      {node.children.map((child) => renderTreeNode(child, depth + 1))}
    </div>
  );
}

export function TraceDetail({ eventId, workspaceId, basePath = "" }: TraceDetailProps) {
  const [data, setData] = useState<{
    event: Record<string, unknown>;
    ancestors: Record<string, unknown>[];
    descendants: { event: Record<string, unknown>; children: unknown[] }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${basePath}/traces/${eventId}?workspaceId=${encodeURIComponent(workspaceId)}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch trace: ${res.statusText}`);
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [eventId, workspaceId, basePath]);

  if (loading) return <p>Loading trace detail...</p>;
  if (error) return <p style={{ color: "red" }}>Error: {error}</p>;
  if (!data) return <p>No trace data found.</p>;

  const evt = data.event;
  const contained = isContainedError(evt.error);
  const details = contained ? getContainedDetails(evt.error) : null;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem", maxWidth: "900px" }}>
      <h2>Trace Detail</h2>

      {contained && details && (
        <div
          style={{
            padding: "1rem",
            background: "#fef2f2",
            border: "2px solid #dc2626",
            borderRadius: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem 0", color: "#dc2626" }}>CONTAINMENT VIOLATION</h3>
          <p>
            Action <code>{details.violatingAction}</code> with permission{" "}
            <code>{details.violatingPermission}</code> exceeded the blast radius of root action{" "}
            <code>{details.rootAction}</code> (allowed: <code>{details.rootBlastRadius.join(", ")}</code>).
          </p>
          <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem", color: "#555" }}>
            This event triggered automatic containment of actor <code>{evt.actorId as string}</code> in
            this workspace.
          </p>
        </div>
      )}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "0.5rem",
          padding: "1rem",
          marginBottom: "1rem",
          background: "#fff",
        }}
      >
        <h3 style={{ marginTop: 0 }}>Event: {evt.actionName as string}</h3>
        <p>
          <strong>Actor:</strong> {evt.actorType as string}:{evt.actorId as string}
        </p>
        <p>
          <strong>Result:</strong>{" "}
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
            {evt.permissionResult as string}
          </span>
        </p>
        <p>
          <strong>Timestamp:</strong> {new Date(evt.startedAt as string).toLocaleString()}
        </p>
        <p>
          <strong>Duration:</strong> {evt.durationMs !== null ? `${evt.durationMs as number}ms` : "—"}
        </p>
        {evt.approved_by && (
          <p>
            <strong>Approved By:</strong> {evt.approved_by as string}
          </p>
        )}
        <p>
          <strong>Input:</strong>
        </p>
        <pre
          style={{
            background: "#f5f5f5",
            padding: "0.75rem",
            borderRadius: "0.25rem",
            overflow: "auto",
          }}
        >
          {JSON.stringify(evt.input, null, 2)}
        </pre>
        {evt.output !== null && (
          <>
            <p>
              <strong>Output:</strong>
            </p>
            <pre
              style={{
                background: "#f5f5f5",
                padding: "0.75rem",
                borderRadius: "0.25rem",
                overflow: "auto",
              }}
            >
              {JSON.stringify(evt.output, null, 2)}
            </pre>
          </>
        )}
        {evt.error !== null && (
          <>
            <p>
              <strong>Error:</strong>
            </p>
            <pre
              style={{
                background: "#fef2f2",
                padding: "0.75rem",
                borderRadius: "0.25rem",
                overflow: "auto",
              }}
            >
              {JSON.stringify(evt.error, null, 2)}
            </pre>
          </>
        )}
      </div>

      {data.ancestors.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h3>Parent Chain</h3>
          {data.ancestors.map((ancestor) =>
            renderTreeNode(
              { event: ancestor, children: [] },
              0
            )
          )}
        </div>
      )}

      {data.descendants.length > 0 && (
        <div>
          <h3>Child Calls</h3>
          {data.descendants.map((child) => renderTreeNode(child, 0))}
        </div>
      )}

      {data.ancestors.length === 0 && data.descendants.length === 0 && (
        <p>No parent or child events.</p>
      )}
    </div>
  );
}
