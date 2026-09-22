import { McpServer, createMcpHandler, fromJsonSchema, type McpRequestContext } from "@modelcontextprotocol/server";
import type {
  ActionRegistry,
  DbClient,
  PermissionEngine,
  Actor,
  DefinedAction,
  ActionExecutionResult,
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

function createStandardSchema(action: DefinedAction<any>) {
  const jsonSchema = zodToJsonSchema(action.input, {
    name: "action",
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  let inputSchema: Record<string, unknown> = { ...jsonSchema };

  if (inputSchema.$ref && typeof inputSchema.$ref === "string") {
    const refPath = inputSchema.$ref;
    if (refPath.startsWith("#/definitions/")) {
      const defName = refPath.replace("#/definitions/", "");
      const definition = (jsonSchema.definitions as Record<string, unknown> | undefined)?.[defName];
      if (definition) {
        inputSchema = { ...definition };
      }
    }
  }

  // Manually create Standard Schema with proper structure matching fromJsonSchema output
  return {
    "~standard": {
      version: 1,
      vendor: "mcp",
      jsonSchema: {
        input: () => inputSchema,
        output: () => inputSchema,
      },
      validate: (data: unknown) => {
        const result = action.input.safeParse(data);
        if (result.success) {
          return { value: result.data };
        } else {
          return { issues: result.error.issues };
        }
      },
    },
  };
}

export function createMcpActionServer(options: McpActionServerOptions): McpActionServer {
  const { registry, dbClient, permissionEngine, defaultWorkspaceId } = options;

  const factory = async (ctx: McpRequestContext) => {
    const server = new McpServer({
      name: "tera-actions",
      version: "1.0.0",
    });

    for (const action of registry.list()) {
      const standardSchema = createStandardSchema(action);

      server.registerTool(
        action.name,
        {
          description: action.description,
          inputSchema: standardSchema,
        },
        async (rawInput: unknown, extra?: any) => {
          console.log("[DEBUG] Tool handler called for:", action.name, "input:", rawInput, "extra:", extra);
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

          const actionContext = {
            actor,
            workspaceId: defaultWorkspaceId,
          };

          try {
            const result = await action.execute(
              rawInput,
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