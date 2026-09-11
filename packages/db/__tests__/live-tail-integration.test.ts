import { describe, it, expect } from "vitest";
import { Pool } from "pg";

const PG_URL =
  process.env.TERA_TEST_DB_URL || "postgresql://postgres:postgres@localhost:5432/tera_test";

describe("Live Tail — realtime integration (DB trigger + subscription)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS action_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        action_name text NOT NULL,
        actor_type text NOT NULL,
        actor_id text NOT NULL,
        input jsonb NOT NULL,
        output jsonb,
        error jsonb,
        permission_result text NOT NULL,
        approved_by text,
        parent_event_id uuid REFERENCES action_events(id),
        started_at timestamptz NOT NULL DEFAULT now(),
        duration_ms int,
        workspace_id uuid NOT NULL,
        blast_radius text[] DEFAULT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION notify_action_event_insert()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('action_events', row_to_json(NEW)::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await pool.query(`DROP TRIGGER IF EXISTS action_events_insert_notify ON action_events`);
    await pool.query(`
      CREATE TRIGGER action_events_insert_notify
        AFTER INSERT ON action_events
        FOR EACH ROW EXECUTE FUNCTION notify_action_event_insert();
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("receives a notification within a reasonable time after an INSERT", async () => {
    const eventId = crypto.randomUUID();
    const workspaceId = "ws-live-integration";

    await pool.query(
      `INSERT INTO action_events (id, action_name, actor_type, actor_id, input, permission_result, workspace_id, started_at, duration_ms, blast_radius, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, now(), now())`,
      [eventId, "testAction", "agent", "agent-1", JSON.stringify({ test: true }), "allow", workspaceId, 10, null]
    );

    const notification = new Promise<Record<string, unknown>>((resolve, reject) => {
      (async () => {
        const client = await pool.connect();
        const timeout = setTimeout(() => {
          client.release();
          reject(new Error("Notification timeout"));
        }, 5000);

        await client.query("LISTEN action_events");
        client.on("notification", (msg) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(msg.payload as string));
          } catch (e) {
            reject(e);
          } finally {
            client.release();
          }
        });
      })();
    });

    const received = await Promise.race([
      notification,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);

    expect(received).toBeDefined();
    expect((received as Record<string, unknown>).id).toBe(eventId);
    expect((received as Record<string, unknown>).workspace_id).toBe(workspaceId);
  }, 15000);

  it("filters correctly — events from other workspaces are not received", async () => {
    const client = await pool.connect();
    const otherWsId = "ws-other-" + crypto.randomUUID();
    const targetWsId = "ws-target-" + crypto.randomUUID();

    try {
      await client.query("LISTEN action_events");

      const notification = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Notification timeout"));
        }, 5000);

        client.on("notification", (msg) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(msg.payload as string));
          } catch (e) {
            reject(e);
          }
        });
      });

      await client.query(
        `INSERT INTO action_events (action_name, actor_type, actor_id, input, permission_result, workspace_id, started_at, duration_ms, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, now(), now())`,
        ["otherEvent", "agent", "agent-1", "{}", "allow", otherWsId, 10]
      );

      await client.query(
        `INSERT INTO action_events (action_name, actor_type, actor_id, input, permission_result, workspace_id, started_at, duration_ms, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, now(), now())`,
        ["targetEvent", "agent", "agent-1", "{}", "allow", targetWsId, 10]
      );

      const received = await Promise.race([
        notification,
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);

      expect((received as Record<string, unknown>).workspace_id).toBe(targetWsId);
    } finally {
      client.release();
    }
  }, 15000);
});
