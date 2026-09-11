import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionValidationError,

  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  withParent,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

class MockDbClient implements DbClient {
  public events: InsertActionEvent[] = [];
  private idMap = new Map<string, InsertActionEvent>();

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

  findEventByActionName(actionName: string) {
    return this.events.find((e) => e.actionName === actionName);
  }

  getEventId(event: InsertActionEvent & { _id?: string }) {
    return event._id;
  }
}

describe("defineAction - event logging", () => {
  it("successful execution writes an event row with correct fields", async () => {
    const dbClient = new MockDbClient();
    const action = defineAction({
      name: "echo",
      description: "Echoes the input",
      permission: "echo.run",
      inputSchema: z.object({ message: z.string() }),
      handler: async (input) => input,
    });

    const result = await action.execute(
      { message: "hello" },
      makeCtx(),
      dbClient
    );

    expect(result.result).toEqual({ message: "hello" });
    expect(result.eventId).toBe("event-1");

    const event = dbClient.findEventByActionName("echo");
    expect(event).toBeDefined();
    expect(event?.actionName).toBe("echo");
    expect(event?.actorType).toBe("human");
    expect(event?.actorId).toBe("user-1");
    expect(event?.input).toEqual({ message: "hello" });
    expect(event?.output).toEqual({ message: "hello" });
    expect(event?.error).toBeNull();
    expect(event?.permissionResult).toBe("allow");
    expect(event?.parentEventId).toBeNull();
    expect(event?.workspaceId).toBe("ws-1");
    expect(event?.startedAt).toBeInstanceOf(Date);
    expect(typeof event?.durationMs).toBe("number");
  });

  it("validation failure writes an event row with error populated", async () => {
    const dbClient = new MockDbClient();
    const handler = vi.fn();

    const action = defineAction({
      name: "strict",
      description: "Requires a string",
      permission: "strict.run",
      inputSchema: z.object({ value: z.string() }),
      handler,
    });

    await expect(
      action.execute({ value: 123 }, makeCtx(), dbClient)
    ).rejects.toThrow(ActionValidationError);
    expect(handler).not.toHaveBeenCalled();

    const event = dbClient.findEventByActionName("strict");
    expect(event).toBeDefined();
    expect(event?.actionName).toBe("strict");
    expect(event?.output).toBeNull();
    expect(event?.error).toBeDefined();
    expect((event?.error as any)?.message).toBe(
      'Invalid input for action "strict"'
    );
    expect((event?.error as any)?.issues).toBeDefined();
    expect(event?.permissionResult).toBe("allow");
    expect(event?.parentEventId).toBeNull();
    expect(event?.durationMs).toBeNull();
  });

  it("handler error writes an event row with error populated", async () => {
    const dbClient = new MockDbClient();
    const action = defineAction({
      name: "failing",
      description: "Always fails",
      permission: "failing.run",
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error("handler exploded");
      },
    });

    await expect(action.execute({}, makeCtx(), dbClient)).rejects.toThrow(
      "handler exploded"
    );

    const event = dbClient.findEventByActionName("failing");
    expect(event).toBeDefined();
    expect(event?.actionName).toBe("failing");
    expect(event?.output).toBeNull();
    expect(event?.error).toBeDefined();
    expect((event?.error as any)?.message).toBe("handler exploded");
    expect((event?.error as any)?.stack).toBeDefined();
    expect(event?.permissionResult).toBe("allow");
    expect(event?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("nested Action call produces a row with correct parent_event_id", async () => {
    const dbClient = new MockDbClient();
    const child = defineAction({
      name: "child",
      description: "Child action",
      permission: "child.run",
      inputSchema: z.object({ value: z.number() }),
      handler: async (input) => ({ doubled: input.value * 2 }),
    });

    const parent = defineAction({
      name: "parent",
      description: "Parent action",
      permission: "parent.run",
      inputSchema: z.object({ value: z.number() }),
      handler: async (input, ctx) => {
        const childResult = await child.execute(
          { value: input.value },
          withParent(ctx, ctx.eventId!),
          dbClient
        );
        return { parentValue: input.value, childResult: childResult.result };
      },
    });

    const parentResult = await parent.execute(
      { value: 5 },
      makeCtx(),
      dbClient
    );

    expect(parentResult.result).toEqual({
      parentValue: 5,
      childResult: { doubled: 10 },
    });
    expect(parentResult.eventId).toBe("event-1");

    const parentEvent = dbClient.findEventByActionName("parent");
    const childEvent = dbClient.findEventByActionName("child");
    expect(parentEvent).toBeDefined();
    expect(childEvent).toBeDefined();
    expect(childEvent?.parentEventId).toBe(
      dbClient.getEventId(parentEvent as any)
    );
  });

  it("does not write events when dbClient is not provided", async () => {
    const action = defineAction({
      name: "silent",
      description: "No db client",
      permission: "silent.run",
      inputSchema: z.object({ value: z.string() }),
      handler: async (input) => input,
    });

    const result = await action.execute({ value: "test" }, makeCtx());
    expect(result.result).toEqual({ value: "test" });
    expect(result.eventId).toBe("");
  });

  it("includes parentEventId from context in event row", async () => {
    const dbClient = new MockDbClient();
    const action = defineAction({
      name: "childWithParent",
      description: "Child with parent",
      permission: "child.run",
      inputSchema: z.object({ value: z.string() }),
      handler: async (input) => input,
    });

    await action.execute(
      { value: "test" },
      makeCtx({ parentEventId: "parent-event-123" }),
      dbClient
    );

    const event = dbClient.findEventByActionName("childWithParent");
    expect(event?.parentEventId).toBe("parent-event-123");
  });
});
