import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    ALTER TABLE action_events
    ADD CONSTRAINT action_events_permission_result_check
    CHECK (permission_result IN (
      'allow', 'deny', 'approval_required', 'delayed', 'pending_confirmation'
    ))
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`
    ALTER TABLE action_events
    DROP CONSTRAINT IF EXISTS action_events_permission_result_check
  `);
};