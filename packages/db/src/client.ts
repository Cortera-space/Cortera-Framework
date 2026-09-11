import { Pool } from "pg";
import type {
  DbClient,
  InsertActionEvent,
  InsertActionApproval,
  ActionApproval,
  ActionEventLookup,
  ActorState,
  InsertActorState,
  ActionEventFull,
  EventTreeNode,
  EventWithChain,
  ListEventsFilters,
  ListEventsResult,
} from "@tera/core";

function mapRowToActionEventFull(row: Record<string, unknown>): ActionEventFull {
  return {
    eventId: row.id as string,
    actionName: row.action_name as string,
    actorType: row.actor_type as ActionEventFull["actorType"],
    actorId: row.actor_id as string,
    permissionResult: row.permission_result as ActionEventFull["permissionResult"],
    status: row.status as string,
    input: row.input,
    output: row.output,
    error: row.error,
    parentEventId: row.parent_event_id as string | null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    startedAt: new Date(row.started_at as string),
    durationMs: row.duration_ms as number | null,
    workspaceId: row.workspace_id as string,
    blastRadius: row.blast_radius as string[] | null,
  };
}

function buildDescendantTree(
  rows: Record<string, unknown>[],
  parentId: string
): EventTreeNode[] {
  const children = rows.filter((r) => r.parent_event_id === parentId);
  return children.map((child) => ({
    event: mapRowToActionEventFull(child),
    children: buildDescendantTree(rows, child.id as string),
  }));
}

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
        started_at, duration_ms, workspace_id, blast_radius
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        event.blastRadius ?? null,
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

  async findEventById(id: string): Promise<ActionEventLookup | null> {
    const { rows } = await this.pool.query(
      `SELECT id, action_name, parent_event_id, blast_radius
       FROM action_events
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      id: row.id,
      actionName: row.action_name,
      parentEventId: row.parent_event_id,
      blastRadius: row.blast_radius ?? null,
    };
  }

  async findActorState(actorId: string, workspaceId: string): Promise<ActorState | null> {
    const { rows } = await this.pool.query(
      `SELECT actor_id, workspace_id, status, contained_at, contained_reason, reviewed_by, reviewed_at
       FROM actor_states
       WHERE actor_id = $1 AND workspace_id = $2`,
      [actorId, workspaceId]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as ActorState["status"],
      containedAt: row.contained_at ? new Date(row.contained_at) : null,
      containedReason: row.contained_reason,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    };
  }

  async upsertActorState(state: InsertActorState): Promise<void> {
    await this.pool.query(
      `INSERT INTO actor_states (actor_id, workspace_id, status, contained_at, contained_reason, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (actor_id, workspace_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         contained_at = EXCLUDED.contained_at,
         contained_reason = EXCLUDED.contained_reason,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at`,
      [
        state.actorId,
        state.workspaceId,
        state.status,
        state.containedAt,
        state.containedReason,
        state.reviewedBy,
        state.reviewedAt,
      ]
    );
  }

  async listEvents(
    workspaceId: string,
    filters: ListEventsFilters,
    limit: number,
    cursor?: { startedAt: Date; id: string }
  ): Promise<ListEventsResult> {
    const conditions: string[] = ["workspace_id = $1"];
    const values: unknown[] = [workspaceId];
    let idx = 2;

    if (filters.actorType) {
      conditions.push(`actor_type = $${idx++}`);
      values.push(filters.actorType);
    }
    if (filters.actionName) {
      conditions.push(`action_name = $${idx++}`);
      values.push(filters.actionName);
    }
    if (filters.permissionResult) {
      conditions.push(`permission_result = $${idx++}`);
      values.push(filters.permissionResult);
    }
    if (filters.from) {
      conditions.push(`started_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conditions.push(`started_at <= $${idx++}`);
      values.push(filters.to);
    }
    if (cursor) {
      conditions.push(`(started_at, id) < ($${idx++}, $${idx++})`);
      values.push(cursor.startedAt, cursor.id);
    }

    const whereClause = conditions.join(" AND ");
    const { rows } = await this.pool.query(
      `SELECT id, action_name, actor_type, actor_id, input, output, error,
              permission_result, approved_by, parent_event_id, started_at,
              duration_ms, workspace_id, blast_radius, created_at, updated_at
       FROM action_events
       WHERE ${whereClause}
       ORDER BY started_at DESC, id DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    const events = rows.map(mapRowToActionEventFull);
    const nextCursor =
      events.length === limit
        ? { startedAt: events[events.length - 1].startedAt, id: events[events.length - 1].eventId }
        : null;

    return { events, nextCursor };
  }

  async getEventWithChain(eventId: string): Promise<EventWithChain | null> {
    const focalRows = await this.pool.query(
      `SELECT id, action_name, actor_type, actor_id, input, output, error,
              permission_result, approved_by, parent_event_id, started_at,
              duration_ms, workspace_id, blast_radius, created_at, updated_at
       FROM action_events
       WHERE id = $1`,
      [eventId]
    );

    if (focalRows.rows.length === 0) {
      return null;
    }

    const focal = mapRowToActionEventFull(focalRows.rows[0]);

    const ancestors: ActionEventFull[] = [];
    let currentParentId: string | null = focal.parentEventId;
    while (currentParentId) {
      const parentRows = await this.pool.query(
        `SELECT id, action_name, actor_type, actor_id, input, output, error,
                permission_result, approved_by, parent_event_id, started_at,
                duration_ms, workspace_id, blast_radius, created_at, updated_at
         FROM action_events
         WHERE id = $1`,
        [currentParentId]
      );
      if (parentRows.rows.length === 0) {
        break;
      }
      const parent = mapRowToActionEventFull(parentRows.rows[0]);
      ancestors.push(parent);
      currentParentId = parent.parentEventId;
    }

    const descendantRows = await this.pool.query(
      `WITH RECURSIVE descendants AS (
         SELECT id, action_name, actor_type, actor_id, input, output, error,
                permission_result, approved_by, parent_event_id, started_at,
                duration_ms, workspace_id, blast_radius, created_at, updated_at
         FROM action_events
         WHERE parent_event_id = $1
         UNION ALL
         SELECT e.id, e.action_name, e.actor_type, e.actor_id, e.input, e.output, e.error,
                e.permission_result, e.approved_by, e.parent_event_id, e.started_at,
                e.duration_ms, e.workspace_id, e.blast_radius, e.created_at, e.updated_at
         FROM action_events e
         INNER JOIN descendants d ON e.parent_event_id = d.id
       )
       SELECT * FROM descendants`,
      [eventId]
    );

    const descendantTree = buildDescendantTree(descendantRows.rows, eventId);

    return {
      event: focal,
      ancestors: ancestors.reverse(),
      descendants: descendantTree,
    };
  }

  async listContainedActors(workspaceId: string): Promise<ActorState[]> {
    const { rows } = await this.pool.query(
      `SELECT actor_id, workspace_id, status, contained_at, contained_reason, reviewed_by, reviewed_at
       FROM actor_states
       WHERE workspace_id = $1 AND status = 'contained'
       ORDER BY contained_at DESC`,
      [workspaceId]
    );
    return rows.map((row) => ({
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as ActorState["status"],
      containedAt: row.contained_at ? new Date(row.contained_at) : null,
      containedReason: row.contained_reason,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
