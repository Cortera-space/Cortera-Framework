import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE data_provenance (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      content_hash text NOT NULL,
      trust_label text NOT NULL CHECK (trust_label IN ('trusted','untrusted-external')),
      source_type text NOT NULL,
      source_identifier text,
      workspace_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.sql(`
    CREATE INDEX data_provenance_content_hash_idx
    ON data_provenance (content_hash)
  `);

  await db.sql(`
    CREATE INDEX data_provenance_workspace_created_idx
    ON data_provenance (workspace_id, created_at DESC)
  `);

  await db.sql(`
    ALTER TABLE action_events
    ADD COLUMN provenance_ids uuid[] DEFAULT '{}'
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`ALTER TABLE action_events DROP COLUMN IF EXISTS provenance_ids`);
  await db.sql(`DROP INDEX IF EXISTS data_provenance_workspace_created_idx`);
  await db.sql(`DROP INDEX IF EXISTS data_provenance_content_hash_idx`);
  await db.sql(`DROP TABLE IF EXISTS data_provenance`);
};