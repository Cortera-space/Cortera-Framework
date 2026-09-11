import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE OR REPLACE FUNCTION notify_action_event_insert()
    RETURNS TRIGGER AS $$
    BEGIN
      PERFORM pg_notify(
        'action_events',
        row_to_json(NEW)::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.sql(`
    CREATE TRIGGER action_events_insert_notify
      AFTER INSERT ON action_events
      FOR EACH ROW EXECUTE FUNCTION notify_action_event_insert();
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP TRIGGER IF EXISTS action_events_insert_notify ON action_events`);
  await db.sql(`DROP FUNCTION IF EXISTS notify_action_event_insert()`);
};
