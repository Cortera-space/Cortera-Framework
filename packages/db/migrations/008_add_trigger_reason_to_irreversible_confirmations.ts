import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    ALTER TABLE irreversible_confirmations
    ADD COLUMN trigger_reason text CHECK (trigger_reason IN ('declared_irreversible', 'untrusted_provenance'))
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`ALTER TABLE irreversible_confirmations DROP COLUMN IF EXISTS trigger_reason`);
};