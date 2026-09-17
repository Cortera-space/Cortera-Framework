import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE TABLE irreversible_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action_event_id uuid NOT NULL REFERENCES action_events(id),
      action_name text NOT NULL,
      input jsonb NOT NULL,
      actor_id text NOT NULL,
      workspace_id uuid NOT NULL,
      confirmation_token text NOT NULL UNIQUE,
      channel text NOT NULL,
      sent_to text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired','rejected')),
      expires_at timestamptz NOT NULL,
      confirmed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.sql(`
    CREATE INDEX irreversible_confirmations_token_idx
    ON irreversible_confirmations (confirmation_token)
  `);

  await db.sql(`
    CREATE INDEX irreversible_confirmations_status_expires_idx
    ON irreversible_confirmations (status, expires_at)
    WHERE status = 'pending'
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP INDEX IF EXISTS irreversible_confirmations_status_expires_idx`);
  await db.sql(`DROP INDEX IF EXISTS irreversible_confirmations_token_idx`);
  await db.sql(`DROP TABLE IF EXISTS irreversible_confirmations`);
};