import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineAction, ActionRegistry, ActionValidationError, type ActionContext, type DbClient, type InsertActionEvent } from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "human" as const, actorId: "user-1" },
  workspaceId: "ws-1",
  ...overrides,
});

class MockDbClient implements DbClient {
  public events: InsertActionEvent[] = [];
  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}`;
    this.events.push(event);
    return { id };
  }
  async updateActionEvent(_id: string, event: Partial<InsertActionEvent>): Promise<void> {
    const existing = this.events.find((e) => e.actionName === event.actionName);
    if (existing) {
      Object.assign(existing, event);
    }
  }
}

describe("defineAction", () => {
  it("valid input runs the handler and returns its result", async () => {
    const action = defineAction({
      name: "echo",
      description: "Echoes the input",
      permission: "echo.run",
      inputSchema: z.object({ message: z.string() }),
      handler: async (input) => input,
    });

    const dbClient = new MockDbClient();
    const result = await action.execute({ message: "hello" }, makeCtx(), dbClient);
    expect(result.result).toEqual({ message: "hello" });
  });

  it("invalid input throws ActionValidationError and handler never runs", async () => {
    const handler = vi.fn();
    const dbClient = new MockDbClient();

    const action = defineAction({
      name: "strict",
      description: "Requires a string",
      permission: "strict.run",
      inputSchema: z.object({ value: z.string() }),
      handler,
    });

    await expect(action.execute({ value: 123 }, makeCtx(), dbClient)).rejects.toThrow(
      ActionValidationError
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("missing description throws at definition time", () => {
    expect(() =>
      defineAction({
        name: "no-desc",
        description: "",
        permission: "nod.run",
        inputSchema: z.object({}),
        handler: async () => {},
      })
    ).toThrow('Action "no-desc" must have a non-empty description');
  });

  it("exposes name, description, permission, and input schema", () => {
    const schema = z.object({ count: z.number() });
    const action = defineAction({
      name: "meta-test",
      description: "Meta",
      permission: "meta.read",
      inputSchema: schema,
      handler: async () => {},
    });

    expect(action.name).toBe("meta-test");
    expect(action.description).toBe("Meta");
    expect(action.permission).toBe("meta.read");
    expect(action.input).toBe(schema);
  });
});

describe("ActionRegistry", () => {
  it("rejects duplicate action names", () => {
    const registry = new ActionRegistry();
    const action = defineAction({
      name: "dup",
      description: "First",
      permission: "dup.run",
      inputSchema: z.object({}),
      handler: async () => {},
    });

    registry.register(action);
    expect(() =>
      registry.register(
        defineAction({
          name: "dup",
          description: "Second",
          permission: "dup.run",
          inputSchema: z.object({}),
          handler: async () => {},
        })
      )
    ).toThrow('Action "dup" is already registered');
  });

  it("get returns undefined for unknown names", () => {
    const registry = new ActionRegistry();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("list returns all registered actions", () => {
    const registry = new ActionRegistry();
    const a = defineAction({
      name: "a",
      description: "A",
      permission: "a.run",
      inputSchema: z.object({}),
      handler: async () => {},
    });
    const b = defineAction({
      name: "b",
      description: "B",
      permission: "b.run",
      inputSchema: z.object({}),
      handler: async () => {},
    });

    registry.register(a);
    registry.register(b);

    expect(registry.list()).toHaveLength(2);
    expect(registry.list().map((x) => x.name)).toEqual(["a", "b"]);
  });
});
