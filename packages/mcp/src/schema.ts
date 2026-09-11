import type { DefinedAction } from "@tera/core";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function generateMcpToolSchema(action: DefinedAction<any>): McpToolSchema {
  const jsonSchema = zodToJsonSchema(action.input, {
    name: action.name,
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  let inputSchema = { ...jsonSchema, $schema: "http://json-schema.org/draft-07/schema#" };

  if (inputSchema.$ref && typeof inputSchema.$ref === "string") {
    const refPath = inputSchema.$ref;
    if (refPath.startsWith("#/definitions/")) {
      const defName = refPath.replace("#/definitions/", "");
      const definition = (jsonSchema.definitions as Record<string, unknown> | undefined)?.[defName];
      if (definition) {
        inputSchema = { ...definition, $schema: "http://json-schema.org/draft-07/schema#" };
      }
    }
  }

  return {
    name: action.name,
    description: action.description,
    inputSchema,
  };
}

export function generateMcpToolList(registry: { list(): DefinedAction<any>[] }): McpToolSchema[] {
  return registry.list().map((action) => generateMcpToolSchema(action));
}
