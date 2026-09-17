import type { DefinedAction } from "@tera/core";
import { zodToJsonSchema } from "zod-to-json-schema";

interface JsonSchema {
  $schema?: string;
  $ref?: string;
  type?: string;
  properties?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
  [key: string]: unknown;
}

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
  }) as JsonSchema;

let inputSchema: JsonSchema = { ...jsonSchema, $schema: "http://json-schema.org/draft-07/schema#" };

  if (inputSchema.$ref && typeof inputSchema.$ref === "string") {
    const refPath = inputSchema.$ref;
    if (refPath.startsWith("#/definitions/")) {
      const defName = refPath.replace("#/definitions/", "");
      const definition = (jsonSchema.definitions as Record<string, unknown> | undefined)?.[defName];
      if (definition) {
        inputSchema = { ...definition as JsonSchema, $schema: "http://json-schema.org/draft-07/schema#" };
      }
    }
  }

  // Inject dryRun field as a framework-level capability
  if (inputSchema.type === "object" && inputSchema.properties) {
    inputSchema = {
      ...inputSchema,
      properties: {
        ...(inputSchema.properties as Record<string, unknown>),
        dryRun: {
          type: "boolean",
          description: "If true, runs the full pre-execution pipeline (containment check, blast-radius evaluation, permission check, input validation) but does not invoke the handler. Returns { wouldSucceed: true } on success or the same error shape as a real failure.",
          default: false,
        },
      },
    };
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
