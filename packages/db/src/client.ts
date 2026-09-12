import { Pool } from "pg";
import type {
  DbClient,
  InsertActionEvent,
  InsertActionApproval,
  ActionApproval,
  ActionEventLookup,
  ActorState,
  InsertActorState,
  ListEventsOptions,
  ListEventsFilters,
  PaginatedResult,
  ActionEvent,
  ActionEventWithChain,
  ContainedActor,
  PendingApprovalWithEvent,
  ListPendingApprovalsOptions,
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
    options?: ListEventsOptions
  ): Promise<PaginatedResult<ActionEvent>> {
    const { filters, limit = 50, cursor } = options ?? {};
    const conditions: string[] = ["workspace_id = $1"];
    const values: unknown[] = [workspaceId];
    let idx = 2;

    if (filters?.actorType) {
      conditions.push(`actor_type = $${idx++}`);
      values.push(filters.actorType);
    }
    if (filters?.actionName) {
      conditions.push(`action_name = $${idx++}`);
      values.push(filters.actionName);
    }
    if (filters?.permissionResult) {
      conditions.push(`permission_result = $${idx++}`);
      values.push(filters.permissionResult);
    }
    if (filters?.from) {
      conditions.push(`started_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters?.to) {
      conditions.push(`started_at <= $${idx++}`);
      values.push(filters.to);
    }
    if (cursor) {
      conditions.push(`started_at < $${idx++}`);
      values.push(new Date(cursor));
    }

    const whereClause = conditions.join(" AND ");
    const sql = `
      SELECT id, action_name, actor_type, actor_id, input, output, error,
             permission_result, approved_by, parent_event_id,
             started_at, duration_ms, workspace_id, blast_radius
      FROM action_events
      WHERE ${whereClause}
      ORDER BY started_at DESC
      LIMIT $${idx}
    `;
    values.push(limit + 1);

    const { rows } = await this.pool.query(sql, values);
    const items = rows.slice(0, limit).map((row) => ({
      eventId: row.id,
      actionName: row.action_name,
      actorType: row.actor_type as ActionEvent["actorType"],
      actorId: row.actor_id,
      permissionResult: row.permission_result as ActionEvent["permissionResult"],
      status: "completed",
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : null,
      error: row.error ? JSON.parse(row.error) : null,
      parentEventId: row.parent_event_id,
      createdAt: new Date(row.started_at),
      updatedAt: new Date(row.started_at),
    }));

    const nextCursor = rows.length > limit ? rows[limit - 1].started_at.toISOString() : null;
    return { items, nextCursor };
  }

  async getEventWithChain(eventId: string): Promise<ActionEventWithChain | null> {
    const ancestorRows = await this.getAncestors(eventId);
    const descendantRows = await this.getDescendants(eventId);

    const allRows = [...ancestorRows, ...descendantRows];
    if (allRows.length === 0) {
      return null;
    }

    const eventMap = new Map<string, ActionEventWithChain>();
    for (const row of allRows) {
      eventMap.set(row.id, {
        eventId: row.id,
        actionName: row.action_name,
        actorType: row.actor_type as ActionEvent["actorType"],
        actorId: row.actor_id,
        permissionResult: row.permission_result as ActionEvent["permissionResult"],
        status: "completed",
        input: JSON.parse(row.input),
        output: row.output ? JSON.parse(row.output) : null,
        error: row.error ? JSON.parse(row.error) : null,
        parentEventId: row.parent_event_id,
        createdAt: new Date(row.started_at),
        updatedAt: new Date(row.started_at),
        ancestors: [],
        descendants: [],
      });
    }

    for (const event of eventMap.values()) {
      if (event.parentEventId && eventMap.has(event.parentEventId)) {
        const parent = eventMap.get(event.parentEventId)!;
        parent.descendants.push(event);
        event.ancestors.push(parent);
      }
    }

    const rootEvent = eventMap.get(eventId);
    if (!rootEvent) {
      return null;
    }

    this.sortTree(rootEvent);
    return rootEvent;
  }

  private async getAncestors(eventId: string) {
    const rows: any[] = [];
    let currentId: string | null = eventId;

    while (currentId) {
      const { rows: result } = await this.pool.query(
        `SELECT id, action_name, actor_type, actor_id, input, output, error,
                permission_result, approved_by, parent_event_id,
                started_at, duration_ms, workspace_id, blast_radius
         FROM action_events
         WHERE id = $1`,
        [currentId]
      );
      if (result.length === 0) break;
      rows.unshift(result[0]);
      currentId = result[0].parent_event_id;
    }

    return rows;
  }

  private async getDescendants(eventId: string) {
    const rows: any[] = [];
    const stack = [eventId];

    while (stack.length > 0) {
      const parentId = stack.pop()!;
      const { rows: result } = await this.pool.query(
        `SELECT id, action_name, actor_type, actor_id, input, output, error,
                permission_result, approved_by, parent_event_id,
                started_at, duration_ms, workspace_id, blast_radius
         FROM action_events
         WHERE parent_event_id = $1
         ORDER BY started_at ASC`,
        [parentId]
      );
      for (const row of result) {
        rows.push(row);
        stack.push(row.id);
      }
    }

    return rows;
  }

  private sortTree(event: ActionEventWithChain) {
    event.ancestors.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    event.descendants.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const child of event.descendants) {
      this.sortTree(child);
    }
  }

  async listContainedActors(workspaceId: string): Promise<ContainedActor[]> {
    const { rows } = await this.pool.query(
      `SELECT actor_id, workspace_id, status, contained_at, contained_reason, reviewed_by, reviewed_at
       FROM actor_states
       WHERE workspace_id = $1 AND status IN ('contained', 'revoked')
       ORDER BY contained_at DESC`,
      [workspaceId]
    );
    return rows.map((row) => ({
      actorId: row.actor_id,
      workspaceId: row.workspace_id,
      status: row.status as "contained" | "revoked",
      containedAt: row.contained_at ? new Date(row.contained_at) : new Date(),
      containedReason: row.contained_reason,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    }));
  }

  async listPendingApprovals(
    workspaceId: string,
    options?: ListPendingApprovalsOptions
  ): Promise<PendingApprovalWithEvent[]> {
    const { filters } = options ?? {};
    let approvalSql = `
      SELECT a.id, a.action_event_id, a.action_name, a.input, a.actor_type, a.actor_id,
             a.workspace_id, a.status, a.requested_at, a.expires_at, a.resolved_at, a.approved_by
      FROM action_approvals a
      WHERE a.status = 'pending' AND a.workspace_id = $1
    `;
    const approvalValues: unknown[] = [workspaceId];
    let idx = 2;

    if (filters?.actionName) {
      approvalSql += ` AND a.action_name = $${idx++}`;
      approvalValues.push(filters.actionName);
    }

    approvalSql += ` ORDER BY a.requested_at ASC`;

    const { rows: approvalRows } = await this.pool.query(approvalSql, approvalValues);

    if (approvalRows.length === 0) {
      return [];
    }

    const eventIds = approvalRows.map((r) => r.action_event_id);
    const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
    const { rows: eventRows } = await this.pool.query(
      `SELECT id, action_name, actor_type, actor_id, input, started_at
       FROM action_events
       WHERE id IN (${placeholders})`,
      eventIds
    );

    const eventMap = new Map(eventRows.map((r) => [r.id, r]));

    return approvalRows.map((approval) => {
      const event = eventMap.get(approval.action_event_id);
      return {
        approval: {
          id: approval.id,
          actionEventId: approval.action_event_id,
          actionName: approval.action_name,
          input: JSON.parse(approval.input),
          actorType: approval.actor_type as ActionApproval["actorType"],
          actorId: approval.actor_id,
          workspaceId: approval.workspace_id,
          status: approval.status as ActionApproval["status"],
          requestedAt: new Date(approval.requested_at),
          expiresAt: new Date(approval.expires_at),
          resolvedAt: approval.resolved_at ? new Date(approval.resolved_at) : null,
          approvedBy: approval.approved_by,
        },
        event: {
          actionName: event?.action_name ?? approval.action_name,
          actorType: (event?.actor_type ?? approval.actor_type) as ActionApproval["actorType"],
          actorId: event?.actor_id ?? approval.actor_id,
          input: event ? JSON.parse(event.input) : JSON.parse(approval.input),
          requestedAt: event ? new Date(event.started_at) : new Date(approval.requested_at),
          expiresAt: new Date(approval.expires_at),
        },
      };
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
