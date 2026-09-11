"use client";

import { createNoteAction, deleteCustomerAction, notifyWatchersAction } from "@/lib/registry";
import { ActionForm, ActionButton } from "@tera/ui";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Tera Example App</h1>
      <p>This page demonstrates auto-generated Action forms and triggers.</p>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Create Note (ActionForm)</h2>
        <p>Allowed for humans — submit the form to create a note.</p>
        <ActionForm
          action={createNoteAction}
          basePath="/app/api/actions"
          actorId="demo-user"
          actorType="human"
          onSuccess={(result: unknown) => console.log("Note created:", result)}
          onError={(error: Error | string) => console.error("Note error:", error)}
        />
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Delete Customer (ActionButton)</h2>
        <p>Requires approval — click the button to see the pending-approval state.</p>
        <ActionButton
          action={deleteCustomerAction}
          input={{ id: "cust-123", reason: "requested by demo" }}
          basePath="/app/api/actions"
          actorId="demo-user"
          actorType="human"
          onSuccess={() => {}}
          onError={(error: Error | string) => console.error("Delete error:", error)}
        />
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Notify Watchers (ActionButton)</h2>
        <p>Denied for humans — click the button to see the permission-denied state.</p>
        <ActionButton
          action={notifyWatchersAction}
          input={{ noteId: "note-1", title: "Hello" }}
          basePath="/app/api/actions"
          actorId="demo-user"
          actorType="human"
          onSuccess={() => {}}
          onError={(error: Error | string) => console.error("Notify error:", error)}
        />
      </section>
    </main>
  );
}
