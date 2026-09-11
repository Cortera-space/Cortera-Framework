import { Pool } from "pg";
import type { DbClient, InsertActionEvent } from "@tera/core";

export type PostgresDbClientOptions = {
  connectionString: string;
};

export class PostgresDbClient implements DbClient {
  private pool: Pool;

  constructor(options: PostgresDbClientOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
  }

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const { rows } = await this.pool.query(
      `INSERT INTO action_events (
        action_name, actor_type, actor_id, input, output, error,
        permission_result, approved_by, parent_event_id,
        started_at, duration_ms, workspace_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        event.actionName,
        event.actorType,
        event.actorId,
        JSON.stringify(event.input),
        event.output !== null ? JSON.stringify(event.output) : null,
        event.error !== null ? JSON.stringify(event.error) : null,
        event.permissionResult,
        event.approvedBy,
        event.parentEventId,
        event.startedAt,
        event.durationMs,
        event.workspaceId,
      ]
    );
    return { id: rows[0].id };
  }

  async updateActionEvent(
    id: string,
    event: Partial<InsertActionEvent>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (event.output !== undefined) {
      setClauses.push(`output = $${idx++}`);
      values.push(event.output !== null ? JSON.stringify(event.output) : null);
    }
    if (event.error !== undefined) {
      setClauses.push(`error = $${idx++}`);
      values.push(event.error !== null ? JSON.stringify(event.error) : null);
    }
    if (event.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${idx++}`);
      values.push(event.durationMs);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(id);
    const sql = `UPDATE action_events SET ${setClauses.join(", ")} WHERE id = $${idx}`;
    await this.pool.query(sql, values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
