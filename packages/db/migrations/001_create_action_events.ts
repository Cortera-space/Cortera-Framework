import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE action_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action_name text NOT NULL,
      actor_type text NOT NULL CHECK (actor_type IN ('human','agent','system')),
      actor_id text NOT NULL,
      input jsonb NOT NULL,
      output jsonb,
      error jsonb,
      permission_result text NOT NULL,
      approved_by text,
      parent_event_id uuid REFERENCES action_events(id),
      started_at timestamptz NOT NULL DEFAULT now(),
      duration_ms int,
      workspace_id uuid NOT NULL
    )
  `);

  await db.sql(`
    CREATE INDEX action_events_workspace_started_at_idx
    ON action_events (workspace_id, started_at DESC)
  `);

  await db.sql(`
    CREATE INDEX action_events_parent_event_id_idx
    ON action_events (parent_event_id)
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS action_events_parent_event_id_idx`);
  await db.sql(`DROP INDEX IF EXISTS action_events_workspace_started_at_idx`);
  await db.sql(`DROP TABLE IF EXISTS action_events`);
};
