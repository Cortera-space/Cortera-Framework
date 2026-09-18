import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE actor_behavior_baselines (
      actor_id text NOT NULL,
      workspace_id uuid NOT NULL,
      action_type_distribution jsonb NOT NULL DEFAULT '{}',
      avg_calls_per_hour numeric,
      typical_hours jsonb,
      last_computed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (actor_id, workspace_id)
    )
  `);

  await db.sql(`
    CREATE INDEX actor_behavior_baselines_workspace_id_idx
    ON actor_behavior_baselines (workspace_id)
  `);

  await db.sql(`
    ALTER TABLE actor_states
    ADD COLUMN containment_reason text CHECK (containment_reason IN ('blast_radius_violation', 'behavioral_drift'))
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`ALTER TABLE actor_states DROP COLUMN IF EXISTS containment_reason`);
  await db.sql(`DROP INDEX IF EXISTS actor_behavior_baselines_workspace_id_idx`);
  await db.sql(`DROP TABLE IF EXISTS actor_behavior_baselines`);
};