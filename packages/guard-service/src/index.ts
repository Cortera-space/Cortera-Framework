import { z } from "zod";
import Fastify from "fastify";
import { ActionRegistry, InMemoryDbClient, InMemoryPermissionEngine, checkActorContainment, checkBlastRadius, ActionContext, Actor, DefinedAction, ActionContainmentError } from "@tera/core";

// Input schema for the /evaluate-call endpoint
const EvaluateCallInputSchema = z.object({
  actor_id: z.string(),
  actor_type: z.enum(["human", "agent", "system"]).default("agent"),
  tool_name: z.string(),
  tool_args: z.record(z.unknown()),
  context_trace: z.array(z.object({
    content: z.unknown(),
    provenance: z.enum(["trusted", "untrusted_external"]),
    role: z.enum(["system", "user", "assistant", "tool"]).optional(),
  })),
  workspace_id: z.string().default("default-workspace"),
  root_action_name: z.string().optional(),
  root_blast_radius: z.array(z.string()).optional(),
});

// Output schema
const EvaluateCallOutputSchema = z.object({
  verdict: z.enum(["allow", "guarded", "block"]),
  containment_reason: z.union([z.literal("blast_radius_violation"), z.literal("behavioral_drift"), z.null()]),
  message: z.string().optional(),
});

type EvaluateCallInput = z.infer<typeof EvaluateCallInputSchema>;
type EvaluateCallOutput = z.infer<typeof EvaluateCallOutputSchema>;

// In-memory registry and DB for the guard service
const registry = new ActionRegistry();
const dbClient = new InMemoryDbClient();
const permissionEngine = new InMemoryPermissionEngine();

// Allow all by default for benchmark
permissionEngine.addRule({ actorType: "agent", permissionKey: "*", result: "allow" });
permissionEngine.addRule({ actorType: "human", permissionKey: "*", result: "allow" });
permissionEngine.addRule({ actorType: "system", permissionKey: "*", result: "allow" });

// Track behavioral drift: map of actor_id -> list of tool calls in current session
const actorCallHistory = new Map<string, Array<{ tool_name: string; timestamp: Date; blast_radius: string[] }>>();

// Known escalation patterns for behavioral drift detection
const ESCALATION_PATTERNS = [
  // Pattern: read-only -> broader read -> write/destructive
  {
    name: "scope_widening",
    steps: [
      { permissions: ["read", "list", "get", "view"], weight: 1 },
      { permissions: ["read:*", "list:*", "get:*", "view:*"], weight: 2 },
      { permissions: ["write", "create", "delete", "update", "destroy", "execute"], weight: 3 },
    ],
    threshold: 5, // cumulative weight threshold
  },
];

function getPermissionCategory(permission: string): number {
  const lower = permission.toLowerCase();
  if (lower.includes("write") || lower.includes("create") || lower.includes("delete") || 
      lower.includes("update") || lower.includes("destroy") || lower.includes("execute") ||
      lower.includes("reserve") || lower.includes("post") || lower.includes("invite") ||
      lower.includes("send") || lower.includes("book") || lower.includes("pay") ||
      lower.includes("transfer")) {
    return 3;
  }
  if (lower.includes("read:*") || lower.includes("list:*") || lower.includes("get:*") || lower.includes("view:*") ||
      lower.endsWith(":*")) {
    return 2;
  }
  if (lower.includes("read") || lower.includes("list") || lower.includes("get") || lower.includes("view")) {
    return 1;
  }
  return 0;
}

function detectBehavioralDrift(actorId: string, toolName: string, blastRadius: string[]): { detected: boolean; reason: string } | null {
  const history = actorCallHistory.get(actorId) || [];
  
  // Calculate escalation score
  let totalWeight = 0;
  for (const call of history) {
    for (const perm of call.blast_radius) {
      totalWeight += getPermissionCategory(perm);
    }
  }
  // Add current call
  for (const perm of blastRadius) {
    totalWeight += getPermissionCategory(perm);
  }
  
  // Check if we have an escalation pattern
  if (totalWeight >= 5 && history.length >= 2) {
    // Check for pattern: started with low-weight, now high-weight
    const earlyCalls = history.slice(0, Math.ceil(history.length / 2));
    const lateCalls = history.slice(Math.ceil(history.length / 2));
    
    let earlyWeight = 0, lateWeight = 0;
    for (const call of earlyCalls) {
      for (const perm of call.blast_radius) {
        earlyWeight += getPermissionCategory(perm);
      }
    }
    for (const call of lateCalls) {
      for (const perm of call.blast_radius) {
        lateWeight += getPermissionCategory(perm);
      }
    }
    // Add current call to late
    for (const perm of blastRadius) {
      lateWeight += getPermissionCategory(perm);
    }
    
    if (lateWeight > earlyWeight * 2 && lateWeight >= 3) {
      return {
        detected: true,
        reason: `Behavioral drift detected: escalation from low-risk (${earlyWeight}) to high-risk (${lateWeight}) operations`
      };
    }
  }
  
  return null;
}

// Build a mock DefinedAction from tool_name for blast radius checking
function buildMockAction(toolName: string, blastRadius: string[]): DefinedAction<any> {
  return {
    name: toolName,
    description: `Mock action for ${toolName}`,
    permission: toolName,
    blastRadius,
    riskTier: "instant",
    input: z.object({}),
    handler: async () => {},
    execute: async () => ({ result: null, eventId: "" }),
  };
}

async function evaluateCall(input: EvaluateCallInput): Promise<EvaluateCallOutput> {
  const actor: Actor = { actorType: input.actor_type, actorId: input.actor_id };
  const workspaceId = input.workspace_id;
  
  // Build context for blast radius checking
  // We use the root_action_name and root_blast_radius from input if provided
  // (these come from the first tool call in the chain)
  const rootActionName = input.root_action_name;
  const rootBlastRadius = input.root_blast_radius || [];
  
  // Get blast radius for the current tool - in real usage this would come from the action registry
  // For benchmark, we'll infer from tool name patterns
  const toolBlastRadius = inferBlastRadius(input.tool_name);
  
  // 1. Check actor containment
  try {
    await checkActorContainment(dbClient, actor, workspaceId);
  } catch (error) {
    if (error instanceof ActionContainmentError) {
      if (error.errorCode === "ACTOR_CONTAINED") {
        return { verdict: "block", containment_reason: "blast_radius_violation", message: error.message };
      }
      return { verdict: "block", containment_reason: null, message: error.message };
    }
    throw error;
  }
  
  // 2. Check blast radius if we have a root action
  if (rootActionName && rootBlastRadius.length > 0) {
    const mockAction = buildMockAction(input.tool_name, toolBlastRadius);
    const mockContext: ActionContext = {
      actor,
      workspaceId,
      parentEventId: "root-event-id", // Would be real in production
    };
    
    // Manually check blast radius since we don't have real parentEventId
    const withinBlastRadius = toolBlastRadius.some(perm => 
      rootBlastRadius.some(pattern => matchesBlastRadius(perm, [pattern]))
    );
    
    if (!withinBlastRadius && toolBlastRadius.length > 0) {
      // Actor gets contained
      await dbClient.upsertActorState({
        actorId: actor.actorId,
        workspaceId,
        status: "contained",
        containedAt: new Date(),
        containedReason: `action "${input.tool_name}" (${toolBlastRadius.join(", ")}) exceeds blast radius of root action "${rootActionName}" (${rootBlastRadius.join(", ")})`,
        reviewedBy: null,
        reviewedAt: null,
      });
      
      return { 
        verdict: "block", 
        containment_reason: "blast_radius_violation",
        message: `Tool "${input.tool_name}" exceeds blast radius of root action "${rootActionName}"` 
      };
    }
  }
  
  // 3. Check behavioral drift
  const driftResult = detectBehavioralDrift(input.actor_id, input.tool_name, toolBlastRadius);
  if (driftResult) {
    // Contain the actor
    await dbClient.upsertActorState({
      actorId: actor.actorId,
      workspaceId,
      status: "contained",
      containedAt: new Date(),
      containedReason: driftResult.reason,
      reviewedBy: null,
      reviewedAt: null,
    });
    
    return {
      verdict: "guarded",
      containment_reason: "behavioral_drift",
      message: driftResult.reason
    };
  }
  
  // 4. Record this call in history
  const history = actorCallHistory.get(input.actor_id) || [];
  history.push({ tool_name: input.tool_name, timestamp: new Date(), blast_radius: toolBlastRadius });
  actorCallHistory.set(input.actor_id, history);
  
  // 5. Check taint tracking - if any context is untrusted and tool is high-risk
  const hasUntrustedContext = input.context_trace.some(c => c.provenance === "untrusted_external");
  const isHighRisk = toolBlastRadius.some(p => getPermissionCategory(p) >= 3);
  
  if (hasUntrustedContext && isHighRisk) {
    // This would be "guarded" in real Tera (requires human approval)
    // For benchmark without human-in-loop, we treat as blocked but log separately
    return {
      verdict: "guarded",
      containment_reason: "blast_radius_violation",
      message: `High-risk tool "${input.tool_name}" called with untrusted context`
    };
  }
  
  return { verdict: "allow", containment_reason: null };
}

function matchesBlastRadius(permissionKey: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    if (regex.test(permissionKey)) {
      return true;
    }
  }
  return false;
}

function inferBlastRadius(toolName: string): string[] {
  const lower = toolName.toLowerCase();
  
  // Banking tools - check these first since they have specific patterns
  if (lower.includes("bank") || lower.includes("transfer") || lower.includes("send_money") || lower.includes("sendmoney") || 
      (lower.includes("send") && (lower.includes("money") || lower.includes("payment") || lower.includes("pay"))) ||
      lower.includes("deposit") || lower.includes("withdraw")) {
    if (lower.includes("view") || lower.includes("list") || lower.includes("get") || lower.includes("balance") || lower.includes("read")) {
      return ["banking:read"];
    }
    if (lower.includes("transfer") || lower.includes("send") || lower.includes("pay") || lower.includes("deposit") || lower.includes("withdraw")) {
      return ["banking:write"];
    }
    if (lower.includes("delete")) {
      return ["banking:delete"];
    }
    return ["banking:*"];
  }
  
  // Slack tools - check before workspace
  if (lower.includes("slack") || lower.includes("channel") || lower.includes("message")) {
    // Check write operations FIRST (more specific)
    if (lower.includes("post") || lower.includes("send") || lower.includes("write") || lower.includes("message") || lower.includes("invite") || lower.includes("add")) {
      return ["slack:write"];
    }
    if (lower.includes("delete") || lower.includes("remove")) {
      return ["slack:delete"];
    }
    // Check read operations LAST
    if (lower.includes("read") || lower.includes("list") || lower.includes("get") || lower.includes("view")) {
      return ["slack:read"];
    }
    if (lower.includes("channel")) {
      return ["slack:read"];
    }
    return ["slack:*"];
  }
  
  // Travel tools
  if (lower.includes("travel") || lower.includes("flight") || lower.includes("itinerary") || lower.includes("book")) {
    if (lower.includes("search") || lower.includes("list") || lower.includes("get") || lower.includes("view") || lower.includes("read")) {
      return ["travel:read"];
    }
    if (lower.includes("book") || lower.includes("reserve") || lower.includes("create") || lower.includes("flight")) {
      return ["travel:write"];
    }
    if (lower.includes("cancel")) {
      return ["travel:delete"];
    }
    return ["travel:*"];
  }
  
  // Workspace tools - check delete/write before read
  if (lower.includes("delete") || lower.includes("remove")) {
    return ["workspace:delete", "files:delete"];
  }
  if (lower.includes("write") || lower.includes("create") || lower.includes("edit") || lower.includes("update")) {
    return ["workspace:write", "files:write"];
  }
  if (lower.includes("file") || lower.includes("read") || lower.includes("list") || lower.includes("get")) {
    return ["workspace:read", "files:read"];
  }
  
  // Generic fallbacks
  if (lower.includes("view") || lower.includes("list") || lower.includes("get") || lower.includes("read") || lower.includes("balance")) {
    return ["read:*"];
  }
  if (lower.includes("write") || lower.includes("create") || lower.includes("edit") || lower.includes("update") || lower.includes("send") || lower.includes("pay")) {
    return ["write:*"];
  }
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("cancel")) {
    return ["delete:*"];
  }
  
  // Default
  return [`${lower.split("_")[0]}:*`];
}

const fastify = Fastify({ logger: true });

fastify.post<{ Body: EvaluateCallInput }>("/evaluate-call", async (request, reply) => {
  const parseResult = EvaluateCallInputSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({ error: "Invalid input", details: parseResult.error.issues });
  }
  
  try {
    const result = await evaluateCall(parseResult.data);
    return result;
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

fastify.get("/health", async () => {
  return { status: "ok" };
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Tera Guard Service listening on port ${PORT}`);
});

export { evaluateCall, inferBlastRadius, detectBehavioralDrift, actorCallHistory };