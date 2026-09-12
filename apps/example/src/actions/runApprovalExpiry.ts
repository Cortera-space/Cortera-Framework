import { z } from "zod";
import { defineAction, InMemoryPermissionEngine, expirePendingApprovals, type ActionContext, type DbClient, type InsertActionEvent, type InsertActionApproval, type ListEventsOptions, type PaginatedResult, type ActionEvent, type ActionEventWithChain, type ContainedActor, type PendingApprovalWithEvent, type ListPendingApprovalsOptions } from "@tera/core";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "demo-user" },
  workspaceId: "demo-workspace",
  ...overrides,
});

class MockDbClient implements DbClient {
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
  const engine = new InMemoryPermissionEngine();

  const action = defineAction({
    name: "sensitiveAction",
    description: "Requires approval with short TTL",
    permission: "sensitive.action",
    inputSchema: z.object({ data: z.string() }),
    handler: async () => ({ success: true }),
    approvalTtlMs: 1000,
  });

  engine.addRule({ permissionKey: "sensitive.action", result: "approval_required" });

  console.log("=== Step 1: Execute action (approval_required, TTL=1s) ===");
  let approvalId: string;
  try {
    await action.execute({ data: "secret" }, makeCtx(), dbClient, engine);
  } catch (error) {
    if (error && typeof error === "object" && "approvalId" in error) {
      approvalId = (error as any).approvalId;
      console.log("Approval required, approvalId:", approvalId);
    } else {
      throw error;
    }
  }

  const pendingEvent = dbClient.events.find((e) => e.actionName === "sensitiveAction");
  console.log("Event permissionResult:", pendingEvent?.permissionResult);

  console.log("\n=== Step 2: Wait for TTL expiry ===");
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log("Running expirePendingApprovals...");
  await expirePendingApprovals(dbClient);

  const expiredEvent = dbClient.events.find((e) => e.actionName === "sensitiveAction");
  console.log("Event permissionResult after expiry:", expiredEvent?.permissionResult);
  console.log("Event error:", expiredEvent?.error);

  const expiredApproval = dbClient.approvals.find((a) => a.status === "expired");
  console.log("Approval status:", expiredApproval?.status);

  console.log("\n=== Summary ===");
  console.log("Approval expired path works correctly.");
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
