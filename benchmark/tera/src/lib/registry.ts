import { ActionRegistry, defineAction, InMemoryPermissionEngine, type DbClient } from "@tera/core";
import { createInvoiceAction } from "./actions/createInvoice";

export const registry = new ActionRegistry();

export const permissionEngine = new InMemoryPermissionEngine();
permissionEngine.addRule({ actorType: "human", permissionKey: "invoices.create", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "invoices.create", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "invoices.read", result: "allow" });
permissionEngine.addRule({ actorType: "agent", permissionKey: "invoices.read", result: "allow" });

class InMemoryDbClient implements DbClient {
  public events: any[] = [];

  async insertActionEvent(event: any): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.events.push({ ...event, id });
    return { id };
  }

  async updateActionEvent(id: string, event: Partial<any>): Promise<void> {
    const existing = this.events.find((e) => e.id === id);
    if (existing) Object.assign(existing, event);
  }

  async insertActionApproval(approval: any): Promise<{ id: string }> {
    return { id: "approval-1" };
  }

  async updateActionApproval(id: string, event: Partial<any>): Promise<void> {}

  async findPendingApprovals(_workspaceId: string): Promise<any[]> { return []; }
  async findAllPendingApprovals(): Promise<any[]> { return []; }
  async findApprovalById(id: string): Promise<any | null> { return null; }
  async findEventById(id: string): Promise<any | null> { return null; }
  async findActorState(actorId: string, workspaceId: string): Promise<any | null> { return null; }
  async upsertActorState(state: any): Promise<void> {}
  async listEvents(workspaceId: string, options?: any): Promise<any> { return { items: [], nextCursor: null }; }
  async getEventWithChain(eventId: string, includeDryRun?: boolean): Promise<any | null> { return null; }
  async listContainedActors(workspaceId: string): Promise<any[]> { return []; }
  async listPendingApprovals(workspaceId: string, options?: any): Promise<any[]> { return []; }
}

export const dbClient = new InMemoryDbClient();

registry.register(createInvoiceAction);

export const defaultWorkspaceId = "default-workspace";