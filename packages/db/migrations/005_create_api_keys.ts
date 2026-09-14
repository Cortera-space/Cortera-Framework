import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE api_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key_hash text NOT NULL UNIQUE,
      actor_id text NOT NULL,
      workspace_id uuid NOT NULL,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      last_used_at timestamptz
    )
  `);

  await db.sql(`
    CREATE INDEX api_keys_key_hash_idx ON api_keys (key_hash)
  `);

  await db.sql(`
    CREATE INDEX api_keys_workspace_id_idx ON api_keys (workspace_id)
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS api_keys_workspace_id_idx`);
  await db.sql(`DROP INDEX IF EXISTS api_keys_key_hash_idx`);
  await db.sql(`DROP TABLE IF EXISTS api_keys`);
};