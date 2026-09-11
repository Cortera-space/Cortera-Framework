import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE actor_states (
      actor_id text NOT NULL,
      workspace_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','contained','revoked')),
      contained_at timestamptz,
      contained_reason text,
      reviewed_by text,
      reviewed_at timestamptz,
      PRIMARY KEY (actor_id, workspace_id)
    )
  `);

  await db.sql(`
    CREATE INDEX actor_states_workspace_id_idx
    ON actor_states (workspace_id)
  `);

  await db.sql(`
    ALTER TABLE action_events
    ADD COLUMN blast_radius text[] DEFAULT NULL
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`ALTER TABLE action_events DROP COLUMN IF EXISTS blast_radius`);
  await db.sql(`DROP INDEX IF EXISTS actor_states_workspace_id_idx`);
  await db.sql(`DROP TABLE IF EXISTS actor_states`);
};
