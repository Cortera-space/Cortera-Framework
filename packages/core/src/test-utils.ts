import type {
  DbClient,
  InsertActionEvent,
  InsertActionApproval,
  ActionApproval,
  ActionEventLookup,
  ActorState,
  InsertActorState,
  ListEventsOptions,
  PaginatedResult,
  ActionEvent,
  ActionEventWithChain,
  ContainedActor,
  PendingApprovalWithEvent,
  ListPendingApprovalsOptions,
  InsertPendingDelayedAction,
  PendingDelayedAction,
  ListPendingDelayedActionsOptions,
  InsertIrreversibleConfirmation,
  IrreversibleConfirmation,
  PendingIrreversibleConfirmationWithEvent,
  DataProvenance,
  InsertDataProvenance,
  ProvenanceTrace,
  ProvenanceTraceEntry,
  ProvenanceLabel,
} from "./types";

export class InMemoryDbClient implements DbClient {
  public events: Array<InsertActionEvent & { id: string }> = [];
  public actorStates = new Map<string, ActorState>();
  private approvals: Array<ActionApproval> = [];
  public pendingDelayedActions: Array<PendingDelayedAction & { id: string }> = [];
  private confirmations: Array<IrreversibleConfirmation> = [];
  public provenance: Array<DataProvenance & { id: string }> = [];

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.events.push({ ...event, id } as InsertActionEvent & { id: string });
    return { id };
  }

  async updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void> {
    const existing = this.events.find((e) => e.id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
    const id = `approval-${this.approvals.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ActionApproval = {
      ...approval,
      id,
    };
    this.approvals.push(record);
    return { id };
  }

  async updateActionApproval(id: string, event: Partial<InsertActionApproval>): Promise<void> {
    const existing = this.approvals.find((a) => a.id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async findPendingApprovals(_workspaceId: string): Promise<ActionApproval[]> {
    return this.approvals.filter((a) => a.status === "pending");
  }

  async findAllPendingApprovals(): Promise<ActionApproval[]> {
    return this.approvals.filter((a) => a.status === "pending");
  }

  async findApprovalById(id: string): Promise<ActionApproval | null> {
    return this.approvals.find((a) => a.id === id) ?? null;
  }

  async findEventById(id: string): Promise<ActionEventLookup | null> {
    const event = this.events.find((e) => e.id === id);
    if (!event) return null;
    return {
      id: event.id,
      actionName: event.actionName,
      parentEventId: event.parentEventId,
      blastRadius: event.blastRadius,
    };
  }

  async findActorState(actorId: string, workspaceId: string): Promise<ActorState | null> {
    return this.actorStates.get(`${actorId}:${workspaceId}`) ?? null;
  }

  async upsertActorState(state: InsertActorState): Promise<void> {
    this.actorStates.set(`${state.actorId}:${state.workspaceId}`, {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    });
  }

  async insertPendingDelayedAction(action: InsertPendingDelayedAction): Promise<{ id: string }> {
    const id = `pending-${this.pendingDelayedActions.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: PendingDelayedAction & { id: string } = {
      id,
      actionEventId: action.actionEventId,
      actionName: action.actionName,
      input: action.input,
      actorId: action.actorId,
      workspaceId: action.workspaceId,
      scheduledRunAt: action.scheduledRunAt,
      status: action.status ?? "pending",
      createdAt: new Date(),
    };
    this.pendingDelayedActions.push(record);
    return { id };
  }

  async updatePendingDelayedAction(
    id: string,
    action: Partial<InsertPendingDelayedAction>
  ): Promise<void> {
    const existing = this.pendingDelayedActions.find((a) => a.id === id);
    if (existing) {
      Object.assign(existing, action);
    }
  }

  async findPendingDelayedActionById(id: string): Promise<PendingDelayedAction | null> {
    const record = this.pendingDelayedActions.find((a) => a.id === id);
    if (!record) return null;
    return record;
  }

  async findPendingDelayedActions(
    workspaceId: string,
    options?: ListPendingDelayedActionsOptions
  ): Promise<PaginatedResult<PendingDelayedAction>> {
    const { filters, limit = 50, cursor } = options ?? {};
    let filtered = this.pendingDelayedActions.filter((a) => a.workspaceId === workspaceId);

    if (filters?.actionName) {
      filtered = filtered.filter((a) => a.actionName === filters.actionName);
    }
    if (filters?.status) {
      filtered = filtered.filter((a) => a.status === filters.status);
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      filtered = filtered.filter((a) => a.createdAt < cursorDate);
    }

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = filtered.slice(0, limit);
    const nextCursor = filtered.length > limit ? filtered[limit - 1].createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async findPendingDelayedActionsDue(workspaceId: string): Promise<PendingDelayedAction[]> {
    const now = new Date();
    return this.pendingDelayedActions.filter(
      (a) =>
        a.workspaceId === workspaceId &&
        a.status === "pending" &&
        a.scheduledRunAt <= now
    );
  }

  async listEvents(
    workspaceId: string,
    options?: ListEventsOptions
  ): Promise<PaginatedResult<ActionEvent>> {
    const { filters, limit = 50, cursor } = options ?? {};
    let filtered = this.events.filter((e) => e.workspaceId === workspaceId);

    if (filters?.actorType) {
      filtered = filtered.filter((e) => e.actorType === filters.actorType);
    }
    if (filters?.actionName) {
      filtered = filtered.filter((e) => e.actionName === filters.actionName);
    }
    if (filters?.permissionResult) {
      filtered = filtered.filter((e) => e.permissionResult === filters.permissionResult);
    }
    if (filters?.from) {
      filtered = filtered.filter((e) => e.startedAt >= filters.from!);
    }
    if (filters?.to) {
      filtered = filtered.filter((e) => e.startedAt <= filters.to!);
    }
    if (filters?.dryRun !== undefined) {
      filtered = filtered.filter((e) => e.dryRun === filters.dryRun);
    } else {
      // Default: exclude dry-run events (treat undefined as false for backward compat)
      filtered = filtered.filter((e) => e.dryRun !== true);
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      filtered = filtered.filter((e) => e.startedAt < cursorDate);
    }

    filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const items = filtered.slice(0, limit).map((e) => ({
      eventId: e.id,
      actionName: e.actionName,
      actorType: e.actorType,
      actorId: e.actorId,
      permissionResult: e.permissionResult as ActionEvent["permissionResult"],
      status: "completed",
      input: e.input,
      output: e.output,
      error: e.error as string | null,
      parentEventId: e.parentEventId,
      createdAt: e.startedAt,
      updatedAt: e.startedAt,
      dryRun: e.dryRun ?? false,
      provenanceLabel: this.getProvenanceLabel(e.id),
      triggerReason: this.getTriggerReason(e.id),
    }));

    const nextCursor = filtered.length > limit ? filtered[limit - 1].startedAt.toISOString() : null;
    return { items, nextCursor };
  }

  async getEventWithChain(eventId: string, includeDryRun = false): Promise<ActionEventWithChain | null> {
    const eventMap = new Map<string, ActionEventWithChain>();
    const allEventIds = new Set<string>();

    let currentId: string | null = eventId;
    while (currentId) {
      const event = this.events.find((e) => e.id === currentId);
      if (!event) break;
      if (!includeDryRun && event.dryRun) break;
      allEventIds.add(currentId);
      currentId = event.parentEventId ?? null;
    }

    const stack = [eventId];
    while (stack.length > 0) {
      const parentId = stack.pop()!;
      const children = this.events.filter((e) => e.parentEventId === parentId && (includeDryRun || !e.dryRun));
      for (const child of children) {
        allEventIds.add(child.id);
        stack.push(child.id);
      }
    }

    for (const id of allEventIds) {
      const event = this.events.find((e) => e.id === id);
      if (!event) continue;
      eventMap.set(id, {
        eventId: event.id,
        actionName: event.actionName,
        actorType: event.actorType,
        actorId: event.actorId,
        permissionResult: event.permissionResult as ActionEvent["permissionResult"],
        status: "completed",
        input: event.input,
        output: event.output,
        error: event.error as string | null,
        parentEventId: event.parentEventId,
        createdAt: event.startedAt,
        updatedAt: event.startedAt,
        dryRun: event.dryRun ?? false,
        provenanceLabel: this.getProvenanceLabel(event.id),
        triggerReason: this.getTriggerReason(event.id),
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

    const targetEvent = eventMap.get(eventId);
    if (!targetEvent) return null;

    targetEvent.ancestors = [];
    this.buildFullAncestorChain(targetEvent, eventMap);

    const serializable = this.makeSerializable(targetEvent, new Set());
    return serializable;
  }

  private buildFullAncestorChain(targetEvent: ActionEventWithChain, eventMap: Map<string, ActionEventWithChain>) {
    let current: ActionEventWithChain | null = targetEvent;
    while (current && current.parentEventId && eventMap.has(current.parentEventId)) {
      const parent: ActionEventWithChain = eventMap.get(current.parentEventId)!;
      targetEvent.ancestors.unshift(parent);
      current = parent;
    }
  }

  private makeSerializable(event: ActionEventWithChain, visited: Set<string>): ActionEventWithChain {
    if (visited.has(event.eventId)) {
      return {
        eventId: event.eventId,
        actionName: event.actionName,
        actorType: event.actorType,
        actorId: event.actorId,
        permissionResult: event.permissionResult,
        status: event.status,
        input: event.input,
        output: event.output,
        error: event.error,
        parentEventId: event.parentEventId,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        dryRun: event.dryRun,
        ancestors: [],
        descendants: [],
      };
    }
    visited.add(event.eventId);

    return {
      ...event,
      ancestors: event.ancestors.map((a) => this.makeSerializable(a, visited)),
      descendants: event.descendants.map((d) => this.makeSerializable(d, visited)),
    };
  }

  private sortTree(event: ActionEventWithChain) {
    event.ancestors.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    event.descendants.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const child of event.descendants) {
      this.sortTree(child);
    }
  }

  async listContainedActors(workspaceId: string): Promise<ContainedActor[]> {
    const contained: ContainedActor[] = [];
    for (const state of this.actorStates.values()) {
      if (state.workspaceId === workspaceId && (state.status === "contained" || state.status === "revoked")) {
        contained.push({
          actorId: state.actorId,
          workspaceId: state.workspaceId,
          status: state.status,
          containedAt: state.containedAt ?? new Date(),
          containedReason: state.containedReason,
          reviewedBy: state.reviewedBy,
          reviewedAt: state.reviewedAt,
        });
      }
    }
    contained.sort((a, b) => b.containedAt.getTime() - a.containedAt.getTime());
    return contained;
  }

  async listPendingApprovals(
    workspaceId: string,
    options?: ListPendingApprovalsOptions
  ): Promise<PendingApprovalWithEvent[]> {
    const { filters } = options ?? {};
    let pending = this.approvals.filter((a) => a.status === "pending" && a.workspaceId === workspaceId);

    if (filters?.actionName) {
      pending = pending.filter((a) => a.actionName === filters.actionName);
    }

    pending.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

    return pending.map((approval) => {
      const event = this.events.find((e) => e.id === approval.actionEventId);
      return {
        approval: {
          ...approval,
        },
        event: {
          actionName: event?.actionName ?? approval.actionName,
          actorType: event?.actorType ?? approval.actorType,
          actorId: event?.actorId ?? approval.actorId,
          input: event?.input ?? approval.input,
          requestedAt: event?.startedAt ?? approval.requestedAt,
          expiresAt: approval.expiresAt,
        },
      };
    });
  }

  async insertIrreversibleConfirmation(confirmation: InsertIrreversibleConfirmation): Promise<{ id: string }> {
    const id = `confirmation-${this.confirmations.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: IrreversibleConfirmation = {
      ...confirmation,
      id,
      createdAt: new Date(),
    };
    this.confirmations.push(record);
    return { id };
  }

  async findIrreversibleConfirmationByToken(token: string): Promise<IrreversibleConfirmation | null> {
    return this.confirmations.find((c) => c.confirmationToken === token) ?? null;
  }

  async updateIrreversibleConfirmation(id: string, confirmation: Partial<InsertIrreversibleConfirmation>): Promise<void> {
    const existing = this.confirmations.find((c) => c.id === id);
    if (existing) {
      Object.assign(existing, confirmation);
    }
  }

  async findPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]> {
    const now = new Date();
    return this.confirmations.filter((c) => c.status === "pending" && c.expiresAt >= now);
  }

  async findAllPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]> {
    return this.confirmations.filter((c) => c.status === "pending");
  }

  async listPendingIrreversibleConfirmations(workspaceId: string): Promise<PendingIrreversibleConfirmationWithEvent[]> {
    const pending = this.confirmations.filter((c) => c.status === "pending" && c.workspaceId === workspaceId);
    return pending.map((confirmation) => {
      const event = this.events.find((e) => e.id === confirmation.actionEventId);
      return {
        confirmation: { ...confirmation },
        event: {
          actionName: event?.actionName ?? confirmation.actionName,
          actorType: event?.actorType ?? "agent",
          actorId: event?.actorId ?? confirmation.actorId,
          input: event?.input ?? confirmation.input,
          requestedAt: event?.startedAt ?? confirmation.createdAt,
          expiresAt: confirmation.expiresAt,
        },
      };
    });
  }

  async insertDataProvenance(provenance: InsertDataProvenance): Promise<{ id: string }> {
    const id = `prov-${this.provenance.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: DataProvenance & { id: string } = {
      ...provenance,
      id,
      createdAt: new Date(),
    };
    this.provenance.push(record);
    return { id };
  }

  async findDataProvenanceByEventId(eventId: string): Promise<DataProvenance[]> {
    return this.provenance
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getProvenanceTrace(eventId: string): Promise<ProvenanceTrace | null> {
    const event = this.events.find((e) => e.id === eventId);
    if (!event) {
      return null;
    }

    const outputProvenance = this.provenance
      .filter((p) => p.eventId === eventId && p.fieldPath === "output")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const outputLabel = outputProvenance[0]?.label ?? "trusted";

    const trace: ProvenanceTraceEntry[] = [];
    this.buildProvenanceTrace(eventId, trace);

    return {
      eventId,
      outputLabel,
      trace,
    };
  }

  private buildProvenanceTrace(eventId: string, trace: ProvenanceTraceEntry[]): void {
    const provenanceRecords = this.provenance
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const p of provenanceRecords) {
      const actionEvent = this.events.find((e) => e.id === p.eventId);
      const entry: ProvenanceTraceEntry = {
        eventId: p.eventId,
        actionName: actionEvent?.actionName ?? "unknown",
        fieldPath: p.fieldPath,
        label: p.label,
        sourceEventId: p.sourceEventId,
        isSanitized: p.label === "trusted" && p.sourceEventId !== null,
      };
      trace.push(entry);

      // Always follow the chain if there's a source event to show full history
      if (p.sourceEventId) {
        this.buildProvenanceTrace(p.sourceEventId, trace);
      }
    }
  }

  private getProvenanceLabel(eventId: string): ProvenanceLabel | undefined {
    const outputProvenance = this.provenance
      .filter((p) => p.eventId === eventId && p.fieldPath === "output")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return outputProvenance[0]?.label;
  }

  private getTriggerReason(eventId: string): TriggerReason | undefined {
    const confirmation = this.confirmations
      .filter((c) => c.actionEventId === eventId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return confirmation?.triggerReason;
  }
}