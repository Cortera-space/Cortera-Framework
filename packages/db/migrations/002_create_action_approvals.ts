import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE action_approvals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action_event_id uuid NOT NULL REFERENCES action_events(id),
      action_name text NOT NULL,
      input jsonb NOT NULL,
      actor_type text NOT NULL CHECK (actor_type IN ('human','agent','system')),
      actor_id text NOT NULL,
      workspace_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
      requested_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      resolved_at timestamptz,
      approved_by text
    )
  `);

  await db.sql(`
    CREATE INDEX action_approvals_workspace_status_idx
    ON action_approvals (workspace_id, status)
  `);

  await db.sql(`
    CREATE INDEX action_approvals_expires_at_idx
    ON action_approvals (expires_at)
    WHERE status = 'pending'
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS action_approvals_expires_at_idx`);
  await db.sql(`DROP INDEX IF EXISTS action_approvals_workspace_status_idx`);
  await db.sql(`DROP TABLE IF EXISTS action_approvals`);
};
