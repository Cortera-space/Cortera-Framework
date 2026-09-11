import { Pool } from "pg";
import type {
  DbClient,
  InsertActionEvent,
  InsertActionApproval,
  ActionApproval,
} from "@tera/core";

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
    if (event.permissionResult !== undefined) {
      setClauses.push(`permission_result = $${idx++}`);
      values.push(event.permissionResult);
    }
    if (event.approvedBy !== undefined) {
      setClauses.push(`approved_by = $${idx++}`);
      values.push(event.approvedBy);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(id);
    const sql = `UPDATE action_events SET ${setClauses.join(", ")} WHERE id = $${idx}`;
    await this.pool.query(sql, values);
  }

  async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
    const { rows } = await this.pool.query(
      `INSERT INTO action_approvals (
        action_event_id, action_name, input, actor_type, actor_id,
        workspace_id, status, requested_at, expires_at, resolved_at, approved_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        approval.actionEventId,
        approval.actionName,
        JSON.stringify(approval.input),
        approval.actorType,
        approval.actorId,
        approval.workspaceId,
        approval.status,
        approval.requestedAt,
        approval.expiresAt,
        approval.resolvedAt,
        approval.approvedBy,
      ]
    );
    return { id: rows[0].id };
  }

  async updateActionApproval(
    id: string,
    event: Partial<InsertActionApproval>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (event.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      values.push(event.status);
    }
    if (event.resolvedAt !== undefined) {
      setClauses.push(`resolved_at = $${idx++}`);
      values.push(event.resolvedAt);
    }
    if (event.approvedBy !== undefined) {
      setClauses.push(`approved_by = $${idx++}`);
      values.push(event.approvedBy);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(id);
    const sql = `UPDATE action_approvals SET ${setClauses.join(", ")} WHERE id = $${idx}`;
    await this.pool.query(sql, values);
  }

  async findPendingApprovals(workspaceId: string): Promise<ActionApproval[]> {
    const { rows } = await this.pool.query(
      `SELECT id, action_event_id, action_name, input, actor_type, actor_id,
              workspace_id, status, requested_at, expires_at, resolved_at, approved_by
       FROM action_approvals
       WHERE status = 'pending' AND workspace_id = $1`,
      [workspaceId]
    );
    return rows.map((row) => ({
      id: row.id,
      actionEventId: row.action_event_id,
      actionName: row.action_name,
      input: JSON.parse(row.input),
      actorType: row.actor_type as ActionApproval["actorType"],
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as ActionApproval["status"],
      requestedAt: new Date(row.requested_at),
      expiresAt: new Date(row.expires_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      approvedBy: row.approved_by,
    }));
  }

  async findAllPendingApprovals(): Promise<ActionApproval[]> {
    const { rows } = await this.pool.query(
      `SELECT id, action_event_id, action_name, input, actor_type, actor_id,
              workspace_id, status, requested_at, expires_at, resolved_at, approved_by
       FROM action_approvals
       WHERE status = 'pending'`
    );
    return rows.map((row) => ({
      id: row.id,
      actionEventId: row.action_event_id,
      actionName: row.action_name,
      input: JSON.parse(row.input),
      actorType: row.actor_type as ActionApproval["actorType"],
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as ActionApproval["status"],
      requestedAt: new Date(row.requested_at),
      expiresAt: new Date(row.expires_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      approvedBy: row.approved_by,
    }));
  }

  async findApprovalById(id: string): Promise<ActionApproval | null> {
    const { rows } = await this.pool.query(
      `SELECT id, action_event_id, action_name, input, actor_type, actor_id,
              workspace_id, status, requested_at, expires_at, resolved_at, approved_by
       FROM action_approvals
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      id: row.id,
      actionEventId: row.action_event_id,
      actionName: row.action_name,
      input: JSON.parse(row.input),
      actorType: row.actor_type as ActionApproval["actorType"],
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as ActionApproval["status"],
      requestedAt: new Date(row.requested_at),
      expiresAt: new Date(row.expires_at),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
      approvedBy: row.approved_by,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
