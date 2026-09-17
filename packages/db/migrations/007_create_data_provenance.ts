import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE data_provenance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL REFERENCES action_events(id) ON DELETE CASCADE,
      field_path text NOT NULL,
      label text NOT NULL CHECK (label IN ('trusted', 'untrusted-external')),
      source_event_id uuid REFERENCES action_events(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.sql(`
    CREATE INDEX data_provenance_event_id_idx
    ON data_provenance (event_id)
  `);

  await db.sql(`
    CREATE INDEX data_provenance_source_event_id_idx
    ON data_provenance (source_event_id)
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS data_provenance_source_event_id_idx`);
  await db.sql(`DROP INDEX IF EXISTS data_provenance_event_id_idx`);
  await db.sql(`DROP TABLE IF EXISTS data_provenance`);
};