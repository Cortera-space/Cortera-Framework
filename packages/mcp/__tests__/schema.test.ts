import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineAction, ActionRegistry } from "@cortera/core";
import { generateMcpToolSchema, generateMcpToolList } from "../src/schema";

describe("generateMcpToolSchema", () => {
  it("converts a flat Zod object schema to JSON Schema with correct shape", () => {
    const action = defineAction({
      name: "createNote",
      description: "Creates a note",
      permission: "notes.create",
      inputSchema: z.object({
        title: z.string(),
        count: z.number(),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.name).toBe("createNote");
    expect(schema.description).toBe("Creates a note");
    expect(schema.inputSchema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "number" },
      },
      required: ["title", "count"],
      additionalProperties: false,
    });
  });

  it("handles nested objects", () => {
    const action = defineAction({
      name: "createUser",
      description: "Creates a user",
      permission: "users.create",
      inputSchema: z.object({
        user: z.object({
          name: z.string(),
          address: z.object({
            city: z.string(),
          }),
        }),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.inputSchema).toMatchObject({
      type: "object",
      properties: {
        user: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            address: {
              type: "object",
              additionalProperties: false,
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
          required: ["name", "address"],
        },
      },
      required: ["user"],
      additionalProperties: false,
    });
  });

  it("handles arrays", () => {
    const action = defineAction({
      name: "bulkCreate",
      description: "Bulk creates items",
      permission: "items.create",
      inputSchema: z.object({
        items: z.array(z.string()),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.inputSchema).toMatchObject({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["items"],
      additionalProperties: false,
    });
  });

  it("handles enums", () => {
    const action = defineAction({
      name: "setPriority",
      description: "Sets priority",
      permission: "tasks.update",
      inputSchema: z.object({
        priority: z.enum(["low", "medium", "high"]),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.inputSchema).toMatchObject({
      type: "object",
      properties: {
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
      },
      required: ["priority"],
      additionalProperties: false,
    });
  });

  it("handles optional fields", () => {
    const action = defineAction({
      name: "createNote",
      description: "Creates a note",
      permission: "notes.create",
      inputSchema: z.object({
        title: z.string(),
        content: z.string().optional(),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.inputSchema).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    });
  });

  it("maps .describe() text to field descriptions", () => {
    const action = defineAction({
      name: "createNote",
      description: "Creates a note",
      permission: "notes.create",
      inputSchema: z.object({
        title: z.string().describe("The title of the note"),
        content: z.string().describe("The body text"),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.inputSchema.properties.title.description).toBe("The title of the note");
    expect(schema.inputSchema.properties.content.description).toBe("The body text");
  });

  it("does not add a fallback description", () => {
    const action = defineAction({
      name: "noDesc",
      description: "Has description",
      permission: "test",
      inputSchema: z.object({
        name: z.string(),
      }),
      handler: async () => ({}),
    });

    const schema = generateMcpToolSchema(action);
    expect(schema.description).toBe("Has description");
  });
});

describe("generateMcpToolList", () => {
  it("maps over every registered action", () => {
    const registry = new ActionRegistry();
    const action1 = defineAction({
      name: "action1",
      description: "First action",
      permission: "test.one",
      inputSchema: z.object({ a: z.string() }),
      handler: async () => ({}),
    });
    const action2 = defineAction({
      name: "action2",
      description: "Second action",
      permission: "test.two",
      inputSchema: z.object({ b: z.number() }),
      handler: async () => ({}),
    });

    registry.register(action1);
    registry.register(action2);

    const list = generateMcpToolList(registry);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: "action1", description: "First action" });
    expect(list[1]).toMatchObject({ name: "action2", description: "Second action" });
  });

  it("returns empty array for empty registry", () => {
    const registry = new ActionRegistry();
    const list = generateMcpToolList(registry);
    expect(list).toHaveLength(0);
  });
});
