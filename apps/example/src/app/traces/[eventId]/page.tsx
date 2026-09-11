"use client";

import React, { useEffect, useState } from "react";
import { TraceDetail } from "@tera/ui";

export default function TraceDetailPage({ params }: { params: { eventId: string } }) {
  const workspaceId = "demo-workspace";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.cookie = `tera-session=${encodeURIComponent(JSON.stringify({ actorId: "demo-user", actorType: "human" }))}; path=/`;
    setReady(true);
  }, []);

  if (!ready) return <p>Loading...</p>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Trace Detail</h1>
      <p>
        <a href="/traces" style={{ color: "#0066cc" }}>← Back to traces</a>
      </p>
      <TraceDetail eventId={params.eventId} workspaceId={workspaceId} basePath="/api" />
    </main>
  );
}
