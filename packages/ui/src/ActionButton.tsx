"use client";

import React, { useState, useCallback } from "react";
import type { DefinedAction } from "@cortera/core";

export interface ActionButtonProps<T = unknown> {
  action: DefinedAction<any>;
  input: Record<string, unknown>;
  onSuccess?: (result: T) => void;
  onError?: (error: Error | string) => void;
  basePath?: string;
  actorId?: string;
  actorType?: "human" | "agent" | "system";
  children?: React.ReactNode;
}

export function ActionButton<T = unknown>({
  action,
  input,
  onSuccess,
  onError,
  basePath = "/actions",
  actorId,
  actorType,
  children,
}: ActionButtonProps<T>) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error" | "pending">("idle");
  const [result, setResult] = useState<T | null>(null);
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setStatus("submitting");
    setMessage(null);

    if (actorId && actorType) {
      document.cookie = `cortera-session=${encodeURIComponent(JSON.stringify({ actorId, actorType }))}; path=/`;
    }

    try {
      const response = await fetch(`${basePath}/${action.name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        credentials: "include",
      });

      const data = await response.json();

      if (response.status === 200) {
        setResult(data.result as T);
        setStatus("success");
        onSuccess?.(data.result as T);
      } else if (response.status === 403) {
        const reason =
          data.reason === "ACTOR_CONTAINED" || data.reason === "ACTOR_REVOKED"
            ? `Action contained: ${data.error}`
            : `Not permitted: ${data.error}`;
        setMessage(reason);
        setStatus("error");
        onError?.(new Error(reason));
      } else if (response.status === 202) {
        setPendingApprovalId(data.approvalId);
        setStatus("pending");
        onError?.(new Error("Pending approval"));
      } else if (response.status === 401) {
        setMessage("Unauthorized: no actor identity found");
        setStatus("error");
        onError?.(new Error("Unauthorized"));
      } else {
        setMessage(data.error || `Request failed with status ${response.status}`);
        setStatus("error");
        onError?.(new Error(data.error));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(msg);
      setStatus("error");
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }, [action, input, basePath, onSuccess, onError, actorId, actorType]);

  if (status === "success" && result !== null) {
    return (
      <div style={{ padding: "1rem", border: "1px solid green", marginBottom: "1rem" }}>
        <h3>Success</h3>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  if (status === "pending" && pendingApprovalId) {
    return (
      <div style={{ padding: "1rem", border: "1px solid orange", marginBottom: "1rem" }}>
        <h3>Pending Approval</h3>
        <p>Approval ID: <code>{pendingApprovalId}</code></p>
      </div>
    );
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={status === "submitting"}>
        {children || `Run ${action.name}`}
      </button>
      {message && <div style={{ color: "red", marginLeft: "1rem", display: "inline" }}>{message}</div>}
    </>
  );
}
