import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    ALTER TABLE action_events
    ADD COLUMN dry_run boolean NOT NULL DEFAULT false
  `);

  await db.sql(`
    CREATE INDEX action_events_dry_run_idx
    ON action_events (dry_run)
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS action_events_dry_run_idx`);
  await db.sql(`ALTER TABLE action_events DROP COLUMN IF EXISTS dry_run`);
};