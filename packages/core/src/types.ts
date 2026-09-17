import type { z } from "zod";

export type Actor = {
  actorType: "human" | "agent" | "system";
  actorId: string;
};

export interface ExecuteOptions {
  dryRun?: boolean;
}

export type ActionContext = {
  actor: Actor;
  workspaceId: string;
  parentEventId?: string;
  eventId?: string;
};

export function withParent(ctx: ActionContext, parentEventId: string): ActionContext {
  return { ...ctx, parentEventId };
}

export class ActionValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly z.ZodIssue[]
  ) {
    super(message);
    this.name = "ActionValidationError";
  }
}

export class ActionPermissionError extends Error {
  constructor(
    message: string,
    public readonly permission: string,
    public readonly permissionResult: "deny"
  ) {
    super(message);
    this.name = "ActionPermissionError";
  }
}

export class ActionContainmentError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly permissionResult: "deny"
  ) {
    super(message);
    this.name = "ActionContainmentError";
  }
}

export class ActionPendingApprovalError extends Error {
  constructor(
    message: string,
    public readonly permission: string,
    public readonly approvalId: string
  ) {
    super(message);
    this.name = "ActionPendingApprovalError";
  }
}

export class ActionPendingIrreversibleConfirmationError extends Error {
  constructor(
    message: string,
    public readonly confirmationId: string
  ) {
    super(message);
    this.name = "ActionPendingIrreversibleConfirmationError";
  }
}

export type ActorStatus = "active" | "contained" | "revoked";

export interface ActorState {
  actorId: string;
  workspaceId: string;
  status: ActorStatus;
  containedAt: Date | null;
  containedReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

export interface InsertActorState {
  actorId: string;
  workspaceId: string;
  status: ActorStatus;
  containedAt: Date | null;
  containedReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

export interface ActionEventLookup {
  id: string;
  actionName: string;
  parentEventId: string | null;
  blastRadius: string[] | null;
}

export type PermissionResult = "allow" | "deny" | "approval_required";

export type RiskTier = "instant" | "delayed" | "irreversible";

export type RiskMode = "guarded" | "autonomous";

export type DelayedExecutionResult = {
  status: "delayed";
  pendingId: string;
  scheduledRunAt: Date;
};

export type PermissionRule = {
  actorId?: string;
  actorType?: Actor["actorType"];
  permissionKey: string;
  result: PermissionResult;
};

export interface PermissionEngine {
  check(
    actor: Actor,
    action: DefinedAction<any>,
    input: unknown,
    workspaceId: string
  ): Promise<PermissionResult>;
}

export interface ActionApproval {
  id: string;
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorType: Actor["actorType"];
  actorId: string;
  workspaceId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  approvedBy: string | null;
}

export interface InsertActionApproval {
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorType: Actor["actorType"];
  actorId: string;
  workspaceId: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: Date;
  expiresAt: Date;
  resolvedAt: Date | null;
  approvedBy: string | null;
}

export type RollbackFn<TOutput = unknown> = (output: TOutput, ctx: ActionContext) => Promise<void>;

export interface ActionConfig<TInput extends z.ZodTypeAny, TOutput = unknown> {
  name: string;
  description: string;
  permission: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>, ctx: ActionContext) => Promise<TOutput>;
  approvalTtlMs?: number;
  blastRadius?: string[];
  riskTier?: RiskTier;
  delayWindowMs?: number;
  confirmationTtlMs?: number;
  rollback?: RollbackFn<TOutput>;
  sanitizes?: boolean;
}

export interface ActionResult<T = unknown> {
  result: T;
  eventId: string;
}

export interface DryRunResult {
  wouldSucceed: true;
  eventId?: string;
}

export type ActionExecutionResult<T = unknown> = ActionResult<T> | DryRunResult;

export interface DefinedAction<TInput extends z.ZodTypeAny, TOutput = unknown> {
  name: string;
  description: string;
  permission: string;
  input: TInput;
  blastRadius?: string[];
  riskTier?: RiskTier;
  delayWindowMs?: number;
  confirmationTtlMs?: number;
  rollback?: RollbackFn<TOutput>;
  sanitizes?: boolean;
  handler: (input: z.infer<TInput>, ctx: ActionContext) => Promise<TOutput>;
  execute(
    rawInput: unknown,
    ctx: ActionContext,
    dbClient?: DbClient,
    permissionEngine?: PermissionEngine,
    options?: ExecuteOptions
  ): Promise<ActionExecutionResult<unknown> | DelayedExecutionResult>;
}

export interface ActionEvent<TInput = unknown, TOutput = unknown> {
  eventId: string;
  actionName: string;
  actorType: Actor["actorType"];
  actorId: string;
  permissionResult: PermissionResult;
  status: string;
  input: TInput;
  output: TOutput | null;
  error: string | null;
  parentEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
  dryRun: boolean;
}

export interface ActionEventWithChain extends ActionEvent {
  ancestors: ActionEventWithChain[];
  descendants: ActionEventWithChain[];
}

export type ProvenanceLabel = "trusted" | "untrusted-external";

export interface DataProvenance {
  id: string;
  eventId: string;
  fieldPath: string;
  label: ProvenanceLabel;
  sourceEventId: string | null;
  createdAt: Date;
}

export interface ProvenanceTraceEntry {
  eventId: string;
  actionName: string;
  fieldPath: string;
  label: ProvenanceLabel;
  sourceEventId: string | null;
  isSanitized: boolean;
}

export interface ProvenanceTrace {
  eventId: string;
  outputLabel: ProvenanceLabel;
  trace: ProvenanceTraceEntry[];
}

export interface ListEventsFilters {
  actorType?: Actor["actorType"];
  actionName?: string;
  permissionResult?: PermissionResult;
  from?: Date;
  to?: Date;
  dryRun?: boolean;
}

export interface ListEventsOptions {
  filters?: ListEventsFilters;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ContainedActor {
  actorId: string;
  workspaceId: string;
  status: "contained" | "revoked";
  containedAt: Date;
  containedReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

export interface PendingApprovalWithEvent {
  approval: ActionApproval;
  event: {
    actionName: string;
    actorType: Actor["actorType"];
    actorId: string;
    input: unknown;
    requestedAt: Date;
    expiresAt: Date;
  };
}

export type DelayedActionStatus = "pending" | "canceled" | "executed";

export interface PendingDelayedAction {
  id: string;
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorId: string;
  workspaceId: string;
  scheduledRunAt: Date;
  status: DelayedActionStatus;
  createdAt: Date;
}

export interface InsertPendingDelayedAction {
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorId: string;
  workspaceId: string;
  scheduledRunAt: Date;
  status?: DelayedActionStatus;
}

export interface ListPendingDelayedActionsFilters {
  actionName?: string;
  status?: DelayedActionStatus;
}

export interface ListPendingDelayedActionsOptions {
  filters?: ListPendingDelayedActionsFilters;
  limit?: number;
  cursor?: string;
}

export interface ListPendingApprovalsFilters {
  actionName?: string;
}

export interface ListPendingApprovalsOptions {
  filters?: ListPendingApprovalsFilters;
}

export interface InsertActionEvent {
  actionName: string;
  actorType: Actor["actorType"];
  actorId: string;
  input: unknown;
  output: unknown | null;
  error: unknown | null;
  permissionResult: string;
  approvedBy: string | null;
  parentEventId: string | null;
  startedAt: Date;
  durationMs: number | null;
  workspaceId: string;
  blastRadius: string[] | null;
  dryRun?: boolean;
}

export type IrreversibleConfirmationStatus = "pending" | "confirmed" | "expired" | "rejected";

export interface IrreversibleConfirmation {
  id: string;
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorId: string;
  workspaceId: string;
  confirmationToken: string;
  channel: string;
  sentTo: string;
  status: IrreversibleConfirmationStatus;
  expiresAt: Date;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface InsertIrreversibleConfirmation {
  actionEventId: string;
  actionName: string;
  input: unknown;
  actorId: string;
  workspaceId: string;
  confirmationToken: string;
  channel: string;
  sentTo: string;
  status: IrreversibleConfirmationStatus;
  expiresAt: Date;
  confirmedAt: Date | null;
}

export interface PendingIrreversibleConfirmationWithEvent {
  confirmation: IrreversibleConfirmation;
  event: {
    actionName: string;
    actorType: Actor["actorType"];
    actorId: string;
    input: unknown;
    requestedAt: Date;
    expiresAt: Date;
  };
}

export interface WorkspaceContact {
  channel: "email" | "sms";
  destination: string;
}

export interface WorkspaceContactResolver {
  getContact(workspaceId: string): Promise<WorkspaceContact | null>;
}

export interface DbClient {
  insertActionEvent(event: InsertActionEvent): Promise<{ id: string }>;
  updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void>;
  insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }>;
  updateActionApproval(id: string, event: Partial<InsertActionApproval>): Promise<void>;
  findPendingApprovals(workspaceId: string): Promise<ActionApproval[]>;
  findAllPendingApprovals(): Promise<ActionApproval[]>;
  findApprovalById(id: string): Promise<ActionApproval | null>;
  findEventById(id: string): Promise<ActionEventLookup | null>;
  findActorState(actorId: string, workspaceId: string): Promise<ActorState | null>;
  upsertActorState(state: InsertActorState): Promise<void>;
  listEvents(workspaceId: string, options?: ListEventsOptions): Promise<PaginatedResult<ActionEvent>>;
  getEventWithChain(eventId: string, includeDryRun?: boolean): Promise<ActionEventWithChain | null>;
  listContainedActors(workspaceId: string): Promise<ContainedActor[]>;
  listPendingApprovals(workspaceId: string, options?: ListPendingApprovalsOptions): Promise<PendingApprovalWithEvent[]>;

  insertPendingDelayedAction(action: InsertPendingDelayedAction): Promise<{ id: string }>;
  updatePendingDelayedAction(id: string, action: Partial<InsertPendingDelayedAction>): Promise<void>;
  findPendingDelayedActionById(id: string): Promise<PendingDelayedAction | null>;
  findPendingDelayedActions(workspaceId: string, options?: ListPendingDelayedActionsOptions): Promise<PaginatedResult<PendingDelayedAction>>;
  findPendingDelayedActionsDue(workspaceId: string): Promise<PendingDelayedAction[]>;

  insertIrreversibleConfirmation(confirmation: InsertIrreversibleConfirmation): Promise<{ id: string }>;
  findIrreversibleConfirmationByToken(token: string): Promise<IrreversibleConfirmation | null>;
  updateIrreversibleConfirmation(id: string, confirmation: Partial<InsertIrreversibleConfirmation>): Promise<void>;
  findPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]>;
  findAllPendingIrreversibleConfirmations(): Promise<IrreversibleConfirmation[]>;
  listPendingIrreversibleConfirmations(workspaceId: string): Promise<PendingIrreversibleConfirmationWithEvent[]>;

  insertDataProvenance(provenance: InsertDataProvenance): Promise<{ id: string }>;
  findDataProvenanceByEventId(eventId: string): Promise<DataProvenance[]>;
  getProvenanceTrace(eventId: string): Promise<ProvenanceTrace | null>;
}

export interface InsertDataProvenance {
  eventId: string;
  fieldPath: string;
  label: ProvenanceLabel;
  sourceEventId: string | null;
}