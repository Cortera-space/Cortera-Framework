import type {
  DbClient,
  ActorBehaviorBaseline,
  InsertActorBehaviorBaseline,
  ActorCallHistoryEntry,
  BehavioralDriftConfig,
  DriftDetectorMatch,
  DriftDetectorName,
} from "./types";

export const DEFAULT_BEHAVIORAL_DRIFT_CONFIG: BehavioralDriftConfig = {
  baselineWindowDays: 30,
  recentWindowHours: 24,
  minCallsForBaseline: 10,
  scopeWideningThreshold: 0.3,
  reconThenStrikeReconWindowHours: 6,
  reconThenStrikeStrikeThreshold: 3,
  dormantThenBurstDormantHours: 168,
  dormantThenBurstBurstThreshold: 20,
};

export async function computeBehaviorBaseline(
  dbClient: DbClient,
  actorId: string,
  workspaceId: string,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG
): Promise<ActorBehaviorBaseline | null> {
  const now = new Date();
  const recentWindowStart = new Date(now.getTime() - config.recentWindowHours * 60 * 60 * 1000);
  const windowStart = new Date(now.getTime() - config.baselineWindowDays * 24 * 60 * 60 * 1000);

  // Baseline is computed from the period BEFORE the recent window
  const history = await dbClient.findActorCallHistory(actorId, workspaceId, windowStart, recentWindowStart);

  if (history.length < config.minCallsForBaseline) {
    return null;
  }

  const actionTypeDistribution: Record<string, number> = {};
  const hourCounts: Record<number, number> = {};

  for (const entry of history) {
    actionTypeDistribution[entry.permissionKey] = (actionTypeDistribution[entry.permissionKey] ?? 0) + 1;
    const hour = entry.timestamp.getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }

  const totalCalls = history.length;
  const totalHours = (now.getTime() - windowStart.getTime()) / (1000 * 60 * 60);
  const avgCallsPerHour = totalCalls / Math.max(1, totalHours);

  const typicalHours = Object.entries(hourCounts)
    .filter(([, count]) => count >= Math.max(1, totalCalls * 0.01))
    .map(([hour]) => parseInt(hour, 10))
    .sort((a, b) => a - b);

  const baseline: ActorBehaviorBaseline = {
    actorId,
    workspaceId,
    actionTypeDistribution,
    avgCallsPerHour,
    typicalHours: typicalHours.length > 0 ? typicalHours : null,
    lastComputedAt: now,
  };

  const insertBaseline: InsertActorBehaviorBaseline = {
    actorId,
    workspaceId,
    actionTypeDistribution,
    avgCallsPerHour,
    typicalHours: typicalHours.length > 0 ? typicalHours : null,
    lastComputedAt: now,
  };

  await dbClient.upsertActorBehaviorBaseline(insertBaseline);

  return baseline;
}

export async function getOrComputeBaseline(
  dbClient: DbClient,
  actorId: string,
  workspaceId: string,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG
): Promise<ActorBehaviorBaseline | null> {
  const existing = await dbClient.findActorBehaviorBaseline(actorId, workspaceId);
  if (existing) {
    const ageHours = (Date.now() - existing.lastComputedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return existing;
    }
  }
  return computeBehaviorBaseline(dbClient, actorId, workspaceId, config);
}

function calculateJSDivergence(
  baselineDist: Record<string, number>,
  recentDist: Record<string, number>
): number {
  const allKeys = new Set([...Object.keys(baselineDist), ...Object.keys(recentDist)]);

  const baselineTotal = Object.values(baselineDist).reduce((a, b) => a + b, 0);
  const recentTotal = Object.values(recentDist).reduce((a, b) => a + b, 0);

  if (baselineTotal === 0 || recentTotal === 0) {
    return 0;
  }

  // Additive smoothing to handle zero probabilities
  const alpha = 0.1;
  const vocabSize = allKeys.size;

  let divergence = 0;
  for (const key of allKeys) {
    const p = ((baselineDist[key] ?? 0) + alpha) / (baselineTotal + alpha * vocabSize);
    const q = ((recentDist[key] ?? 0) + alpha) / (recentTotal + alpha * vocabSize);
    const m = (p + q) / 2;
    divergence += 0.5 * (p * Math.log(p / m) + q * Math.log(q / m));
  }

  return divergence;
}

function getNewActionTypesInRecent(
  baselineDist: Record<string, number>,
  recentDist: Record<string, number>
): string[] {
  return Object.keys(recentDist).filter((key) => !baselineDist[key]);
}

function getPermissionRiskLevel(permissionKey: string): number {
  if (permissionKey.includes("delete") || permissionKey.includes("destroy") || permissionKey.includes("bulkDelete")) {
    return 3;
  }
  if (permissionKey.includes("write") || permissionKey.includes("create") || permissionKey.includes("update")) {
    return 2;
  }
  if (permissionKey.includes("read") || permissionKey.includes("view") || permissionKey.includes("list")) {
    return 1;
  }
  return 1;
}

export async function detectScopeWidening(
  actorId: string,
  workspaceId: string,
  history: ActorCallHistoryEntry[],
  baseline: ActorBehaviorBaseline | null,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  now: Date = new Date(),
  currentActionPermissionKey?: string
): Promise<DriftDetectorMatch | null> {
  if (!baseline || history.length === 0) {
    return null;
  }

  const recentWindowStart = new Date(now.getTime() - config.recentWindowHours * 60 * 60 * 1000);
  const recentHistory = history.filter((h) => h.timestamp >= recentWindowStart);

  if (recentHistory.length < 3 && !currentActionPermissionKey) {
    return null;
  }

  const recentDist: Record<string, number> = {};
  for (const entry of recentHistory) {
    recentDist[entry.permissionKey] = (recentDist[entry.permissionKey] ?? 0) + 1;
  }

  // Include the current action in recent distribution if provided
  if (currentActionPermissionKey) {
    recentDist[currentActionPermissionKey] = (recentDist[currentActionPermissionKey] ?? 0) + 1;
  }

  const newActionTypes = getNewActionTypesInRecent(baseline.actionTypeDistribution, recentDist);

  if (newActionTypes.length === 0) {
    return null;
  }

  const divergence = calculateJSDivergence(baseline.actionTypeDistribution, recentDist);

  if (divergence >= config.scopeWideningThreshold) {
    return {
      detector: "scope_widening",
      explanation: `Actor's recent calls (last ${config.recentWindowHours}h) show significant scope widening. ` +
        `JS divergence: ${divergence.toFixed(3)} (threshold: ${config.scopeWideningThreshold}). ` +
        `New action types observed: ${newActionTypes.join(", ")}. ` +
        `Historical distribution: ${JSON.stringify(baseline.actionTypeDistribution)}. ` +
        `Recent distribution: ${JSON.stringify(recentDist)}.`,
      severity: divergence > config.scopeWideningThreshold * 1.5 ? "high" : "medium",
    };
  }

  return null;
}

export async function detectReconThenStrike(
  actorId: string,
  workspaceId: string,
  history: ActorCallHistoryEntry[],
  baseline: ActorBehaviorBaseline | null,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  now: Date = new Date(),
  currentActionPermissionKey?: string
): Promise<DriftDetectorMatch | null> {
  if (history.length < config.reconThenStrikeStrikeThreshold + 1) {
    return null;
  }

  const recentWindowStart = new Date(now.getTime() - config.reconThenStrikeReconWindowHours * 60 * 60 * 1000);
  const recentHistory = history.filter((h) => h.timestamp >= recentWindowStart);

  if (recentHistory.length < config.reconThenStrikeStrikeThreshold + 1) {
    return null;
  }

  const sortedHistory = [...recentHistory].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const lastEntry = sortedHistory[sortedHistory.length - 1];
  const precedingEntries = sortedHistory.slice(0, -1);

  const lastRiskLevel = getPermissionRiskLevel(lastEntry.permissionKey);
  const precedingMaxRisk = Math.max(...precedingEntries.map((e) => getPermissionRiskLevel(e.permissionKey)), 0);

  if (lastRiskLevel <= precedingMaxRisk) {
    return null;
  }

  const precedingReadOnly = precedingEntries.every(
    (e) => getPermissionRiskLevel(e.permissionKey) === 1
  );

  const strikeIsRare = baseline
    ? (baseline.actionTypeDistribution[lastEntry.permissionKey] ?? 0) < 3
    : true;

  if (precedingReadOnly && precedingEntries.length >= 3 && strikeIsRare) {
    return {
      detector: "recon_then_strike",
      explanation: `Detected recon-then-strike pattern. ` +
        `${precedingEntries.length} read-only/low-risk calls (recon) in last ${config.reconThenStrikeReconWindowHours}h ` +
        `followed by higher-risk call "${lastEntry.permissionKey}" (risk level ${lastRiskLevel}). ` +
        `Preceding calls: ${precedingEntries.map((e) => e.permissionKey).join(", ")}. ` +
        `${strikeIsRare ? "Strike action is rare/never used historically." : "Strike action used before."}`,
      severity: "high",
    };
  }

  return null;
}

export async function detectDormantThenBurst(
  actorId: string,
  workspaceId: string,
  history: ActorCallHistoryEntry[],
  baseline: ActorBehaviorBaseline | null,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  now: Date = new Date(),
  currentActionPermissionKey?: string
): Promise<DriftDetectorMatch | null> {
  if (history.length < config.dormantThenBurstBurstThreshold) {
    return null;
  }

  const dormantWindowStart = new Date(now.getTime() - config.dormantThenBurstDormantHours * 60 * 60 * 1000);
  const burstWindowStart = new Date(now.getTime() - config.recentWindowHours * 60 * 60 * 1000);

  const dormantPeriodHistory = history.filter(
    (h) => h.timestamp >= dormantWindowStart && h.timestamp < burstWindowStart
  );
  const burstPeriodHistory = history.filter((h) => h.timestamp >= burstWindowStart);

  const dormantCalls = dormantPeriodHistory.length;
  const burstCalls = burstPeriodHistory.length;

  if (dormantCalls > 2 || burstCalls < config.dormantThenBurstBurstThreshold) {
    return null;
  }

  const baselineAvgPerHour = baseline?.avgCallsPerHour ?? 0;
  const burstRate = burstCalls / config.recentWindowHours;

  if (burstRate > Math.max(5, baselineAvgPerHour * 10)) {
    return {
      detector: "dormant_then_burst",
      explanation: `Actor was dormant (${dormantCalls} calls in ${config.dormantThenBurstDormantHours}h) ` +
        `then burst with ${burstCalls} calls in ${config.recentWindowHours}h ` +
        `(rate: ${burstRate.toFixed(1)}/hr vs baseline ${baselineAvgPerHour.toFixed(1)}/hr).`,
      severity: burstRate > baselineAvgPerHour * 50 ? "high" : "medium",
    };
  }

  return null;
}

export const DRIFT_DETECTORS: Array<{
  name: DriftDetectorName;
  fn: typeof detectScopeWidening | typeof detectReconThenStrike | typeof detectDormantThenBurst;
}> = [
  { name: "scope_widening", fn: detectScopeWidening },
  { name: "recon_then_strike", fn: detectReconThenStrike },
  { name: "dormant_then_burst", fn: detectDormantThenBurst },
];

export async function runAllDetectors(
  dbClient: DbClient,
  actorId: string,
  workspaceId: string,
  config: BehavioralDriftConfig = DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  now: Date = new Date(),
  currentActionPermissionKey?: string
): Promise<DriftDetectorMatch[]> {
  const historyWindowStart = new Date(
    now.getTime() - Math.max(
      config.baselineWindowDays * 24 * 60 * 60 * 1000,
      config.dormantThenBurstDormantHours * 60 * 60 * 1000
    )
  );
  const history = await dbClient.findActorCallHistory(actorId, workspaceId, historyWindowStart);
  
  // Filter to only include allowed actions for behavioral analysis
  const allowedHistory = history.filter((h) => h.permissionResult === "allow");
  
  const baseline = await getOrComputeBaseline(dbClient, actorId, workspaceId, config);

  const matches: DriftDetectorMatch[] = [];

  for (const { name, fn } of DRIFT_DETECTORS) {
    const match = await fn(actorId, workspaceId, allowedHistory, baseline, config, now, currentActionPermissionKey);
    if (match) {
      matches.push(match);
    }
  }

  return matches;
}