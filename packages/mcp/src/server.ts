import { McpServer, createMcpHandler, fromJsonSchema, type McpRequestContext } from "@modelcontextprotocol/server";
import type {
  ActionRegistry,
  DbClient,
  PermissionEngine,
  Actor,
  DefinedAction,
  ActionExecutionResult,
  ActionContext,
  TrustLabel,
} from "@tera/core";
import {
  ActionValidationError,
  ActionPermissionError,
  ActionContainmentError,
  ActionPendingApprovalError,
} from "@tera/core";
import { zodToJsonSchema } from "zod-to-json-schema";
import { validateApiKey } from "@tera/auth";

export interface McpActionServerOptions {
  registry: ActionRegistry;
  dbClient: DbClient;
  permissionEngine: PermissionEngine;
  defaultWorkspaceId: string;
}

export interface McpActionServer {
  createHandler(): ReturnType<typeof createMcpHandler>;
  factory: (ctx: McpRequestContext) => Promise<McpServer>;
}

export interface McpToolCallInput {
  [key: string]: unknown;
  _provenance?: Record<string, TrustLabel>;
}

function toStandardSchema(zodSchema: any) {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    name: "action",
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  let inputSchema: Record<string, unknown> = { ...jsonSchema, $schema: "http://json-schema.org/draft-07/schema#" };

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

  return fromJsonSchema(inputSchema);
}

export function createMcpActionServer(options: McpActionServerOptions): McpActionServer {
  const { registry, dbClient, permissionEngine, defaultWorkspaceId } = options;

  const factory = async (ctx: McpRequestContext) => {
    const server = new McpServer({
      name: "tera-actions",
      version: "1.0.0",
    });

    for (const action of registry.list()) {
      server.registerTool(
        action.name,
        {
          description: action.description,
          inputSchema: toStandardSchema(action.input),
        },
        async (rawInput: unknown) => {
          const apiKey =
            ctx.requestInfo?.headers.get("x-tera-api-key") ??
            ctx.authInfo?.extra?.apiKey;

          let actor: Actor;
          if (typeof apiKey === "string") {
            const validation = await validateApiKey(dbClient, apiKey);
            if (validation) {
              actor = {
                actorId: validation.actorId,
                actorType: "agent",
              };
            } else {
              actor = {
                actorId: "mcp-client",
                actorType: "agent",
              };
            }
          } else {
            actor = {
              actorId: "mcp-client",
              actorType: "agent",
            };
          }

          // Extract provenance from input if present
          const inputWithProvenance = rawInput as McpToolCallInput;
          const { _provenance, ...actualInput } = inputWithProvenance;

          const actionContext: ActionContext = {
            actor,
            workspaceId: defaultWorkspaceId,
            inputProvenance: _provenance,
          };

          try {
            const result = await action.execute(
              actualInput,
              actionContext,
              dbClient,
              permissionEngine
            );
            let resultValue: unknown;
            if ("wouldSucceed" in result) {
              resultValue = { wouldSucceed: true };
            } else {
              resultValue = result.result;
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(resultValue),
                },
              ],
            };
          } catch (error) {
            if (error instanceof ActionValidationError) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      error: error.message,
                      details: error.issues,
                    }),
                  },
                ],
                isError: true,
              };
            }

            if (error instanceof ActionPermissionError) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      error: error.message,
                      reason: error.permissionResult,
                    }),
                  },
                ],
                isError: true,
              };
            }

            if (error instanceof ActionContainmentError) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      error: error.message,
                      reason: error.errorCode,
                    }),
                  },
                ],
                isError: true,
              };
            }

            if (error instanceof ActionPendingApprovalError) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      status: "pending",
                      approvalId: error.approvalId,
                    }),
                  },
                ],
                isError: true,
              };
            }

            throw error;
          }
        }
      );
    }

    return server;
  };

  return {
    createHandler: () => createMcpHandler(factory),
    factory,
  };
}
