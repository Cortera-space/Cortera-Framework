"use client";

import React, { useEffect, useState } from "react";
import { LiveTail } from "@tera/ui";

export default function LiveTailPage() {
  const workspaceId = "demo-workspace";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.cookie = `tera-session=${encodeURIComponent(JSON.stringify({ actorId: "demo-user", actorType: "human" }))}; path=/`;
    setReady(true);
  }, []);

  if (!ready) return <p>Loading…</p>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Live Tail</h1>
      <p>Watch action events stream in real time as they happen.</p>
      <LiveTail workspaceId={workspaceId} basePath="/api" />
      <p style={{ marginTop: "2rem" }}>
        <a href="/" style={{ color: "#0066cc" }}>← Back to home</a>
      </p>
    </main>
  );
}
