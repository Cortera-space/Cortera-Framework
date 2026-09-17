import { z } from "zod";
import {
  defineAction,
  ActionRegistry,
  InMemoryPermissionEngine,
  resolveApproval,
  type ActionContext,
  type InsertActionEvent,
  type InsertActionApproval,
  type ListEventsOptions,
  type PaginatedResult,
  type ActionEvent,
  type ActionEventWithChain,
  type ContainedActor,
  type PendingApprovalWithEvent,
  type ListPendingApprovalsOptions,
} from "@tera/core";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "demo-user" },
  workspaceId: "demo-workspace",
  ...overrides,
});

class MockDbClient {
  public events: InsertActionEvent[] = [];
  public approvals: InsertActionApproval[] = [];
  private idMap = new Map<string, InsertActionEvent>();
  private approvalIdMap = new Map<string, InsertActionApproval>();

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}`;
    const storedEvent = { ...event, _id: id } as InsertActionEvent & { _id: string };
    this.events.push(storedEvent);
    this.idMap.set(id, storedEvent);
    return { id };
  }

  async updateActionEvent(
    id: string,
    event: Partial<InsertActionEvent>
  ): Promise<void> {
    const existing = this.idMap.get(id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async insertActionApproval(approval: InsertActionApproval): Promise<{ id: string }> {
    const id = `approval-${this.approvals.length + 1}`;
    const storedApproval = { ...approval, _id: id } as InsertActionApproval & { _id: string };
    this.approvals.push(storedApproval);
    this.approvalIdMap.set(id, storedApproval);
    return { id };
  }

  async updateActionApproval(
    id: string,
    event: Partial<InsertActionApproval>
  ): Promise<void> {
    const existing = this.approvalIdMap.get(id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async findPendingApprovals(_workspaceId: string): Promise<any[]> {
    return this.approvals
      .filter((a) => a.status === "pending")
      .map((a) => ({ ...a, id: (a as any)._id }));
  }

  async findAllPendingApprovals(): Promise<any[]> {
    return this.findPendingApprovals("");
  }

  async findApprovalById(id: string): Promise<any | null> {
    const approval = this.approvalIdMap.get(id);
    if (!approval) {
      return null;
    }
    return { ...approval, id: (approval as any)._id };
  }

  async findEventById(_id: string): Promise<any | null> { return null; }
  async findActorState(_actorId: string, _workspaceId: string): Promise<any | null> { return null; }
  async upsertActorState(_state: any): Promise<void> {}

  // Observability methods - not implemented for demo
  async listEvents(_workspaceId: string, _options?: ListEventsOptions): Promise<PaginatedResult<ActionEvent>> {
    return { items: [], nextCursor: null };
  }
  async getEventWithChain(_eventId: string): Promise<ActionEventWithChain | null> { return null; }
  async listContainedActors(_workspaceId: string): Promise<ContainedActor[]> { return []; }
  async listPendingApprovals(_workspaceId: string, _options?: ListPendingApprovalsOptions): Promise<PendingApprovalWithEvent[]> { return []; }
}

async function main() {
  const dbClient = new MockDbClient();
  const registry = new ActionRegistry();
  const engine = new InMemoryPermissionEngine();

  const createNoteAction = defineAction({
    name: "createNote",
    description: "Creates a note",
    permission: "notes.create",
    inputSchema: z.object({ title: z.string(), content: z.string() }),
    handler: async (input) => ({ id: "note-1", ...input }),
  });

  const deleteCustomerAction = defineAction({
    name: "deleteCustomer",
    description: "Deletes a customer",
    permission: "customers.delete",
    inputSchema: z.object({ id: z.string() }),
    handler: async (input) => ({ deleted: true, customerId: input.id }),
    approvalTtlMs: 24 * 60 * 60 * 1000,
  });

  registry.register(createNoteAction as any);
  registry.register(deleteCustomerAction as any);

  engine.addRule({ permissionKey: "notes.create", result: "allow" });
  engine.addRule({ permissionKey: "customers.delete", result: "approval_required" });

  console.log("=== Step 1: Create note (allow) ===");
  const noteResult = await createNoteAction.execute(
    { title: "Hello", content: "World" },
    makeCtx(),
    dbClient as any,
    engine
  ) as { result: any; eventId: string };
  console.log("createNote result:", noteResult.result);

  console.log("\n=== Step 2: Delete customer (approval_required) ===");
  let approvalId: string | undefined;
  try {
    await deleteCustomerAction.execute(
      { id: "cust-123" },
      makeCtx(),
      dbClient as any,
      engine
    );
  } catch (error) {
    if (error && typeof error === "object" && "approvalId" in error) {
      approvalId = (error as any).approvalId;
      console.log("Approval required, approvalId:", approvalId);
    } else {
      throw error;
    }
  }

  const pendingEvent = dbClient.events.find((e) => e.actionName === "deleteCustomer");
  console.log("Event permissionResult:", pendingEvent?.permissionResult);

  console.log("\n=== Step 3: Resolve approval (approved) ===");
  if (!approvalId) {
    throw new Error("approvalId was not set");
  }
  await resolveApproval(approvalId, "approved", "approver-1", dbClient as any, registry as any);

  const approvedEvent = dbClient.events.find((e) => e.actionName === "deleteCustomer");
  console.log("Event permissionResult after approval:", approvedEvent?.permissionResult);
  console.log("Event output:", approvedEvent?.output);
  console.log("Event approvedBy:", approvedEvent?.approvedBy);

  console.log("\n=== Summary ===");
  console.log("Events:");
  for (const event of dbClient.events) {
    console.log(`  - ${event.actionName}: ${event.permissionResult}`);
  }
  console.log("Approvals:");
  for (const approval of dbClient.approvals) {
    console.log(`  - ${approval.actionName}: ${approval.status}`);
  }
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
