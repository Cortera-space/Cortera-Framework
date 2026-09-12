import type { MigrationBuilder } from "node-pg-migrate";

export type Migration = (db: MigrationBuilder) => Promise<void>;

export const up: Migration = async (db) => {
  await db.sql(`
    CREATE OR REPLACE FUNCTION notify_action_event_insert()
    RETURNS trigger AS $$
    BEGIN
      PERFORM pg_notify(
        'action_events',
        json_build_object(
          'event_id', NEW.id,
          'action_name', NEW.action_name,
          'actor_type', NEW.actor_type,
          'actor_id', NEW.actor_id,
          'permission_result', NEW.permission_result,
          'workspace_id', NEW.workspace_id,
          'started_at', NEW.started_at
        )::text
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.sql(`
    DROP TRIGGER IF EXISTS action_events_notify_trigger ON action_events;
    CREATE TRIGGER action_events_notify_trigger
    AFTER INSERT ON action_events
    FOR EACH ROW
    EXECUTE FUNCTION notify_action_event_insert();
  `);
};

export const down: Migration = async (db) => {
  await db.sql(`DROP TRIGGER IF EXISTS action_events_notify_trigger ON action_events;`);
  await db.sql(`DROP FUNCTION IF EXISTS notify_action_event_insert();`);
};