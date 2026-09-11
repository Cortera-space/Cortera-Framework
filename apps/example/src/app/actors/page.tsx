"use client";

import React, { useEffect, useState } from "react";
import { ContainedActorsPanel } from "@tera/ui";

export default function ActorsPage() {
  const workspaceId = "demo-workspace";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.cookie = `tera-session=${encodeURIComponent(JSON.stringify({ actorId: "demo-user", actorType: "human" }))}; path=/`;
    setReady(true);
  }, []);

  if (!ready) return <p>Loading...</p>;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Contained Actors</h1>
      <p>
        <a href="/" style={{ color: "#0066cc" }}>← Back to home</a>
      </p>
      <ContainedActorsPanel workspaceId={workspaceId} basePath="/api" />
    </main>
  );
}
