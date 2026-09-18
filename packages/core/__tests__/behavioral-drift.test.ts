import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import {
  defineAction,
  ActionContainmentError,
  type ActionContext,
  type DbClient,
  type InsertActionEvent,
  withParent,
  getActorState,
  reviewContainedActor,
  computeBehaviorBaseline,
  detectScopeWidening,
  detectReconThenStrike,
  detectDormantThenBurst,
  runAllDetectors,
  DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
  DriftDetectorRegistry,
  defaultDriftDetectorRegistry,
  type ActorBehaviorBaseline,
  type ActorCallHistoryEntry,
  type BehavioralDriftConfig,
  type DriftDetectorMatch,
} from "../src/index";

const makeCtx = (overrides?: Partial<ActionContext>): ActionContext => ({
  actor: { actorType: "agent" as const, actorId: "test-agent" },
  workspaceId: "ws-1",
  ...overrides,
});

class MockDbClient implements DbClient {
  public events: Array<InsertActionEvent & { id: string; _id?: string }> = [];
  public actorStates = new Map<string, any>();
  public behaviorBaselines = new Map<string, ActorBehaviorBaseline>();

  async insertActionEvent(event: InsertActionEvent): Promise<{ id: string }> {
    const id = `event-${this.events.length + 1}`;
    const storedEvent = { ...event, _id: id } as InsertActionEvent & { _id: string };
    this.events.push(storedEvent);
    return { id };
  }

  async updateActionEvent(id: string, event: Partial<InsertActionEvent>): Promise<void> {
    const existing = this.events.find((e) => e._id === id);
    if (existing) {
      Object.assign(existing, event);
    }
  }

  async insertActionApproval(_approval: any): Promise<{ id: string }> {
    return { id: "approval-1" };
  }

  async updateActionApproval(_id: string, _event: Partial<any>): Promise<void> {}

  async findPendingApprovals(): Promise<any[]> {
    return [];
  }

  async findAllPendingApprovals(): Promise<any[]> {
    return [];
  }

  async findApprovalById(_id: string): Promise<any | null> {
    return null;
  }

  async findEventById(id: string): Promise<any | null> {
    const stored = this.events.find((e) => e._id === id);
    if (!stored) return null;
    return {
      id: stored._id,
      actionName: stored.actionName,
      parentEventId: stored.parentEventId,
      blastRadius: stored.blastRadius,
    };
  }

  async findActorState(actorId: string, workspaceId: string): Promise<any | null> {
    const key = `${actorId}:${workspaceId}`;
    const state = this.actorStates.get(key);
    if (!state) return null;
    return {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status as any,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      containmentReason: state.containmentReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    };
  }

  async upsertActorState(state: any): Promise<void> {
    const key = `${state.actorId}:${state.workspaceId}`;
    this.actorStates.set(key, {
      actorId: state.actorId,
      workspaceId: state.workspaceId,
      status: state.status,
      containedAt: state.containedAt,
      containedReason: state.containedReason,
      containmentReason: state.containmentReason,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedAt,
    });
  }

  async listEvents(_workspaceId: string, _options?: any): Promise<any> {
    return { items: [], nextCursor: null };
  }

  async getEventWithChain(_eventId: string): Promise<any> {
    return null;
  }

  async listContainedActors(_workspaceId: string): Promise<any[]> {
    return [];
  }

  async listPendingApprovals(_workspaceId: string, _options?: any): Promise<any[]> {
    return [];
  }

  async insertPendingDelayedAction(_action: any): Promise<{ id: string }> {
    return { id: "pending-1" };
  }

  async updatePendingDelayedAction(_id: string, _action: Partial<any>): Promise<void> {}

  async findPendingDelayedActionById(_id: string): Promise<any | null> {
    return null;
  }

  async findPendingDelayedActions(_workspaceId: string, _options?: any): Promise<any> {
    return { items: [], nextCursor: null };
  }

  async findPendingDelayedActionsDue(_workspaceId: string): Promise<any[]> {
    return [];
  }

  async insertIrreversibleConfirmation(_confirmation: any): Promise<{ id: string }> {
    return { id: "confirmation-1" };
  }

  async findIrreversibleConfirmationByToken(_token: string): Promise<any | null> {
    return null;
  }

  async updateIrreversibleConfirmation(_id: string, _confirmation: Partial<any>): Promise<void> {}

  async findPendingIrreversibleConfirmations(): Promise<any[]> {
    return [];
  }

  async findAllPendingIrreversibleConfirmations(): Promise<any[]> {
    return [];
  }

  async listPendingIrreversibleConfirmations(_workspaceId: string): Promise<any[]> {
    return [];
  }

  async findActorBehaviorBaseline(actorId: string, workspaceId: string): Promise<ActorBehaviorBaseline | null> {
    return this.behaviorBaselines.get(`${actorId}:${workspaceId}`) ?? null;
  }

  async upsertActorBehaviorBaseline(baseline: any): Promise<void> {
    this.behaviorBaselines.set(`${baseline.actorId}:${baseline.workspaceId}`, baseline);
  }

  async findActorCallHistory(
    actorId: string,
    workspaceId: string,
    from: Date,
    to?: Date,
    limit?: number
  ): Promise<ActorCallHistoryEntry[]> {
    let filtered = this.events.filter(
      (e) => e.workspaceId === workspaceId && e.actorId === actorId && e.startedAt >= from
    );

    if (to) {
      filtered = filtered.filter((e) => e.startedAt <= to!);
    }

    filtered.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    if (limit) {
      filtered = filtered.slice(0, limit);
    }

    return filtered.map((e) => ({
      actionName: e.actionName,
      permissionKey: (e.error as any)?.violatingPermission ?? e.actionName,
      timestamp: e.startedAt,
      permissionResult: e.permissionResult as ActorCallHistoryEntry["permissionResult"],
    }));
  }
}

describe("behavioral-drift", () => {
  let dbClient: MockDbClient;

  beforeEach(() => {
    dbClient = new MockDbClient();
    defaultDriftDetectorRegistry.detectors.clear();
  });

  describe("computeBehaviorBaseline", () => {
    it("returns null when insufficient history", async () => {
      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1");
      expect(baseline).toBeNull();
    });

    it("computes baseline from sufficient history", async () => {
      const now = new Date();
      // Events older than 24h (recent window) so they're included in baseline
      // With default config (30d baseline, 24h recent), insert at 25-37 hours ago
      for (let hour = 25; hour <= 37; hour++) {
        await dbClient.insertActionEvent({
          actionName: "notes.create",
          actorType: "agent",
          actorId: "test-agent",
          input: { n: hour },
          output: null,
          error: null,
          permissionResult: "allow",
          approvedBy: null,
          parentEventId: null,
          startedAt: new Date(now.getTime() - hour * 3600000),
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1");
      expect(baseline).not.toBeNull();
      expect(baseline!.actionTypeDistribution["notes.create"]).toBe(13);
      expect(baseline!.avgCallsPerHour).toBeGreaterThan(0);
      expect(baseline!.typicalHours).toBeInstanceOf(Array);
    });

    it("stores baseline in database", async () => {
      const now = new Date();
      for (let i = 0; i < 15; i++) {
        await dbClient.insertActionEvent({
          actionName: "notes.create",
          actorType: "agent",
          actorId: "test-agent",
          input: { n: i },
          output: null,
          error: null,
          permissionResult: "allow",
          approvedBy: null,
          parentEventId: null,
          startedAt: new Date(now.getTime() - (25 + i) * 3600000),
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      await computeBehaviorBaseline(dbClient, "test-agent", "ws-1");
      const stored = await dbClient.findActorBehaviorBaseline("test-agent", "ws-1");
      expect(stored).not.toBeNull();
      expect(stored!.actionTypeDistribution["notes.create"]).toBe(15);
    });
  });

  describe("detectScopeWidening", () => {
    it("detects scope widening when actor uses new action types", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      // Custom config with 1-day baseline window, so recent events (last 5h) are outside baseline
      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 1,
        recentWindowHours: 6,
      };

      // Establish baseline: only notes.create for 1 day (but older than 6h)
      for (let hour = 7; hour <= 24; hour++) {
        for (let i = 0; i < 2; i++) {
          baselineHistory.push({
            actionName: "notes.create",
            permissionKey: "notes.create",
            timestamp: new Date(now.getTime() - (hour + i) * 3600000),
            permissionResult: "allow",
          });
        }
      }

      // Recent window (last 6h): new action types appear
      for (let i = 0; i < 5; i++) {
        recentHistory.push({
          actionName: "customers.delete",
          permissionKey: "customers.delete",
          timestamp: new Date(now.getTime() - i * 3600000),
          permissionResult: "allow",
        });
        recentHistory.push({
          actionName: "workspaces.delete",
          permissionKey: "workspaces.delete",
          timestamp: new Date(now.getTime() - i * 3600000 - 1800000),
          permissionResult: "allow",
        });
      }

      const allHistory = [...baselineHistory, ...recentHistory];

      // Insert ALL events for history
      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      // Manually compute baseline with custom config
      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      expect(baseline).not.toBeNull();

      // Pass combined history to detector with custom config
      const match = await detectScopeWidening("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).not.toBeNull();
      expect(match!.detector).toBe("scope_widening");
      expect(match!.explanation).toContain("scope widening");
      expect(match!.explanation).toContain("customers.delete");
      expect(match!.explanation).toContain("workspaces.delete");
    });

    it("does NOT trigger when actor's behavior is consistent with baseline (false positive test)", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 30,
        recentWindowHours: 24,
      };

      // Actor has ALWAYS used both notes.create and notes.read (baseline: older than 24h)
      for (let day = 1; day <= 30; day++) {
        for (let i = 0; i < 2; i++) {
          baselineHistory.push({
            actionName: "notes.create",
            permissionKey: "notes.create",
            timestamp: new Date(now.getTime() - (day * 24 + i) * 3600000),
            permissionResult: "allow",
          });
        }
        baselineHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - (day * 24 + 5) * 3600000),
          permissionResult: "allow",
        });
      }

      // Recent calls are ALSO notes.create and notes.read - same pattern
      for (let i = 0; i < 5; i++) {
        recentHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - i * 3600000),
          permissionResult: "allow",
        });
        recentHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - i * 3600000 - 1800000),
          permissionResult: "allow",
        });
      }

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1");
      expect(baseline).not.toBeNull();

      const match = await detectScopeWidening("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      // Should NOT match - behavior is consistent with established baseline
      expect(match).toBeNull();
    });

    it("does NOT trigger when insufficient recent calls", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 30,
        recentWindowHours: 24,
      };

      for (let day = 1; day <= 30; day++) {
        baselineHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - day * 24 * 3600000),
          permissionResult: "allow",
        });
      }

      // Only 1 recent call - below threshold
      recentHistory.push({
        actionName: "customers.delete",
        permissionKey: "customers.delete",
        timestamp: new Date(now.getTime() - 3600000),
        permissionResult: "allow",
      });

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1");
      const match = await detectScopeWidening("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).toBeNull();
    });
  });

  describe("detectReconThenStrike", () => {
    it("detects recon-then-strike pattern", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      // Custom config with 1-day baseline window
      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 1,
        recentWindowHours: 6,
        reconThenStrikeReconWindowHours: 6,
        reconThenStrikeStrikeThreshold: 3,
      };

      // Baseline: only notes.read historically (older than 6 hours)
      for (let hour = 7; hour <= 24; hour++) {
        baselineHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - hour * 3600000),
          permissionResult: "allow",
        });
      }

      // Recent (last 6 hours): burst of read-only calls followed by a delete
      // notes.read at 5h, 4h, 3h, 2h, 1h ago
      for (let i = 0; i < 5; i++) {
        recentHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - (5 - i) * 3600000),
          permissionResult: "allow",
        });
      }
      // The strike (very recent) - 10 minutes ago
      recentHistory.push({
        actionName: "customers.delete",
        permissionKey: "customers.delete",
        timestamp: new Date(now.getTime() - 10 * 60000),
        permissionResult: "allow",
      });

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectReconThenStrike("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).not.toBeNull();
      expect(match!.detector).toBe("recon_then_strike");
      expect(match!.explanation).toContain("recon-then-strike");
      expect(match!.explanation).toContain("customers.delete");
    });

    it("does NOT trigger when strike action is part of normal behavior (false positive test)", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 1,
        recentWindowHours: 6,
        reconThenStrikeReconWindowHours: 6,
        reconThenStrikeStrikeThreshold: 3,
      };

      // Actor REGULARLY uses both read and delete (throughout 1 day baseline)
      for (let hour = 7; hour <= 24; hour++) {
        baselineHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - hour * 3600000),
          permissionResult: "allow",
        });
        baselineHistory.push({
          actionName: "customers.delete",
          permissionKey: "customers.delete",
          timestamp: new Date(now.getTime() - hour * 3600000 - 1800000),
          permissionResult: "allow",
        });
      }

      // Recent: same pattern - reads followed by delete (normal for this actor)
      for (let i = 0; i < 3; i++) {
        recentHistory.push({
          actionName: "notes.read",
          permissionKey: "notes.read",
          timestamp: new Date(now.getTime() - (4 - i) * 3600000),
          permissionResult: "allow",
        });
      }
      recentHistory.push({
        actionName: "customers.delete",
        permissionKey: "customers.delete",
        timestamp: new Date(now.getTime() - 30 * 60000),
        permissionResult: "allow",
      });

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectReconThenStrike("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      // Should NOT match - this is NORMAL behavior for this actor
      expect(match).toBeNull();
    });

    it("does NOT trigger when no read-only precursor", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 1,
        recentWindowHours: 6,
        reconThenStrikeReconWindowHours: 6,
        reconThenStrikeStrikeThreshold: 3,
      };

      // Baseline: only notes.create (older than 6 hours)
      for (let hour = 7; hour <= 24; hour++) {
        baselineHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - hour * 3600000),
          permissionResult: "allow",
        });
      }

      // Recent: direct delete with no read precursor
      recentHistory.push({
        actionName: "customers.delete",
        permissionKey: "customers.delete",
        timestamp: new Date(now.getTime() - 3600000),
        permissionResult: "allow",
      });

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectReconThenStrike("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).toBeNull();
    });
  });

  describe("detectDormantThenBurst", () => {
    it("detects dormant-then-burst pattern", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 10, // 10 days to include the dormant period
        recentWindowHours: 24,
        dormantThenBurstDormantHours: 168,
        dormantThenBurstBurstThreshold: 20,
        minCallsForBaseline: 2,
      };

      // Long dormant period (168 hours = 7 days) with very few calls (<= 2)
      // This is within the 10-day baseline window but older than 24h
      // Add only 2 events in the dormant window (168h to 24h ago)
      baselineHistory.push({
        actionName: "notes.read",
        permissionKey: "notes.read",
        timestamp: new Date(now.getTime() - 5 * 24 * 3600000),
        permissionResult: "allow",
      });
      baselineHistory.push({
        actionName: "notes.read",
        permissionKey: "notes.read",
        timestamp: new Date(now.getTime() - 3 * 24 * 3600000),
        permissionResult: "allow",
      });

      // Burst: many calls in last 24 hours (high rate > 5/hour)
      for (let i = 0; i < 130; i++) {
        recentHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - (i * 10) * 60000), // every 10 minutes
          permissionResult: "allow",
        });
      }

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectDormantThenBurst("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).not.toBeNull();
      expect(match!.detector).toBe("dormant_then_burst");
      expect(match!.explanation).toContain("dormant");
      expect(match!.explanation).toContain("burst");
    });

    it("does NOT trigger when actor has consistent activity (false positive test)", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 30,
        recentWindowHours: 24,
        dormantThenBurstDormantHours: 168,
        dormantThenBurstBurstThreshold: 20,
      };

      // Actor has been consistently active (throughout 30 days)
      for (let day = 1; day <= 30; day++) {
        for (let i = 0; i < 3; i++) {
          baselineHistory.push({
            actionName: "notes.create",
            permissionKey: "notes.create",
            timestamp: new Date(now.getTime() - (day * 24 + i * 8) * 3600000),
            permissionResult: "allow",
          });
        }
      }

      // Recent period: same consistent rate
      for (let i = 0; i < 20; i++) {
        recentHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - i * 3600000),
          permissionResult: "allow",
        });
      }

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectDormantThenBurst("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      // Should NOT match - this is NORMAL consistent activity
      expect(match).toBeNull();
    });

    it("does NOT trigger when no dormant period", async () => {
      const now = new Date();
      const baselineHistory: ActorCallHistoryEntry[] = [];
      const recentHistory: ActorCallHistoryEntry[] = [];

      const testConfig = {
        ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
        baselineWindowDays: 10,
        recentWindowHours: 24,
        dormantThenBurstDormantHours: 168,
        dormantThenBurstBurstThreshold: 20,
      };

      // Consistent activity with no long gap (10 days of regular activity)
      for (let day = 1; day <= 10; day++) {
        for (let i = 0; i < 5; i++) {
          baselineHistory.push({
            actionName: "notes.create",
            permissionKey: "notes.create",
            timestamp: new Date(now.getTime() - (day * 24 + i * 4) * 3600000),
            permissionResult: "allow",
          });
        }
      }

      // Recent period continues the same pattern
      for (let i = 0; i < 10; i++) {
        recentHistory.push({
          actionName: "notes.create",
          permissionKey: "notes.create",
          timestamp: new Date(now.getTime() - i * 3600000),
          permissionResult: "allow",
        });
      }

      const allHistory = [...baselineHistory, ...recentHistory];

      for (const entry of allHistory) {
        await dbClient.insertActionEvent({
          actionName: entry.actionName,
          actorType: "agent",
          actorId: "test-agent",
          input: {},
          output: null,
          error: null,
          permissionResult: entry.permissionResult,
          approvedBy: null,
          parentEventId: null,
          startedAt: entry.timestamp,
          durationMs: 10,
          workspaceId: "ws-1",
          blastRadius: null,
        });
      }

      const baseline = await computeBehaviorBaseline(dbClient, "test-agent", "ws-1", testConfig);
      const match = await detectDormantThenBurst("test-agent", "ws-1", allHistory, baseline!, testConfig, now);
      expect(match).toBeNull();
    });
  });

  describe("runAllDetectors integration", () => {
    it("detects scope widening and contains actor", async () => {
      const notesCreate = defineAction({
        name: "notes.create",
        description: "Create a note",
        permission: "notes.create",
        inputSchema: z.object({ title: z.string() }),
        handler: async (input) => ({ id: "note-1", ...input }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
          minCallsForBaseline: 10,
        },
      });

      const customersDelete = defineAction({
        name: "customers.delete",
        description: "Delete a customer",
        permission: "customers.delete",
        inputSchema: z.object({ id: z.string() }),
        handler: async (input) => ({ deleted: true, id: input.id }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
          minCallsForBaseline: 10,
        },
      });

      const now = new Date();
      // Establish baseline of only notes.create (older than 6h, within 24h baseline window)
      // Insert 2 events per hour for 13 hours (hours 8-20) = 26 events
      for (let hour = 8; hour <= 20; hour++) {
        for (let i = 0; i < 2; i++) {
          await dbClient.insertActionEvent({
            actionName: "notes.create",
            actorType: "agent",
            actorId: "test-agent",
            input: { title: `Note ${hour}-${i}` },
            output: { id: `note-${hour}-${i}` },
            error: null,
            permissionResult: "allow",
            approvedBy: null,
            parentEventId: null,
            startedAt: new Date(now.getTime() - hour * 3600000),
            durationMs: 10,
            workspaceId: "ws-1",
            blastRadius: null,
          });
        }
      }

      // Now attempt scope-widening call
      await expect(
        customersDelete.execute(
          { id: "cust-1" },
          makeCtx(),
          dbClient
        )
      ).rejects.toThrow(ActionContainmentError);

      const state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
      expect(state).toBeDefined();
      expect(state?.status).toBe("contained");
      expect(state?.containmentReason).toBe("behavioral_drift");
      expect(state?.containedReason).toContain("scope_widening");
    });

    it("reviewContainedActor lifts behavioral drift containment", async () => {
      const notesCreate = defineAction({
        name: "notes.create",
        description: "Create a note",
        permission: "notes.create",
        inputSchema: z.object({ title: z.string() }),
        handler: async (input) => ({ id: "note-1", ...input }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
          minCallsForBaseline: 10,
        },
      });

      const customersDelete = defineAction({
        name: "customers.delete",
        description: "Delete a customer",
        permission: "customers.delete",
        inputSchema: z.object({ id: z.string() }),
        handler: async (input) => ({ deleted: true, id: input.id }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
minCallsForBaseline: 10,
        },
      });

      const now = new Date();
      // Establish baseline of only notes.create (older than 6h, within 24h baseline window)
      // Insert 2 events per hour for 13 hours (hours 8-20) = 26 events
      for (let hour = 8; hour <= 20; hour++) {
        for (let i = 0; i < 2; i++) {
          await dbClient.insertActionEvent({
            actionName: "notes.create",
            actorType: "agent",
            actorId: "test-agent",
            input: { title: `Note ${hour}-${i}` },
            output: { id: `note-${hour}-${i}` },
            error: null,
            permissionResult: "allow",
            approvedBy: null,
            parentEventId: null,
            startedAt: new Date(now.getTime() - hour * 3600000),
            durationMs: 10,
            workspaceId: "ws-1",
            blastRadius: null,
          });
        }
      }

      await expect(
        customersDelete.execute(
          { id: "cust-1" },
          makeCtx(),
          dbClient
        )
      ).rejects.toThrow(ActionContainmentError);

      let state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
      expect(state?.status).toBe("contained");
      expect(state?.containmentReason).toBe("behavioral_drift");

      // Lift the containment
      await reviewContainedActor(dbClient, "test-agent", "ws-1", "lift", "reviewer-1");

      state = await getActorState(dbClient, makeCtx().actor, makeCtx().workspaceId);
      expect(state?.status).toBe("active");
      expect(state?.containmentReason).toBeNull();

      // Should work now - use notes.create which is in the baseline
      const result = await notesCreate.execute(
        { title: "After lift" },
        makeCtx(),
        dbClient
      );
      expect(result.result).toEqual({ id: "note-1", title: "After lift" });
    });
  });

  describe("DriftDetectorRegistry", () => {
    it("registers and runs custom detectors", async () => {
      const registry = new DriftDetectorRegistry();

      const customMatch: DriftDetectorMatch = {
        detector: "scope_widening",
        explanation: "custom detector triggered",
        severity: "high",
      };

      const customDetector = vi.fn().mockResolvedValue(customMatch);
      registry.register("scope_widening", customDetector);

      const history: ActorCallHistoryEntry[] = [];
      const baseline: ActorBehaviorBaseline = {
        actorId: "test-agent",
        workspaceId: "ws-1",
        actionTypeDistribution: { "notes.create": 100 },
        avgCallsPerHour: 1,
        typicalHours: [9, 10, 11],
        lastComputedAt: new Date(),
      };

      const matches = await registry.runAll("test-agent", "ws-1", history, baseline, DEFAULT_BEHAVIORAL_DRIFT_CONFIG);
      expect(matches).toHaveLength(1);
      expect(matches[0].explanation).toBe("custom detector triggered");
      expect(customDetector).toHaveBeenCalled();
    });

    it("throws on duplicate registration", () => {
      const registry = new DriftDetectorRegistry();
      registry.register("scope_widening", async () => null);
      expect(() => registry.register("scope_widening", async () => null)).toThrow();
    });
  });

  describe("full pipeline: behavioral drift containment blocks subsequent calls", () => {
    it("after containment, all calls from actor are denied", async () => {
      const notesCreate = defineAction({
        name: "notes.create",
        description: "Create a note",
        permission: "notes.create",
        inputSchema: z.object({ title: z.string() }),
        handler: async (input) => ({ id: "note-1", ...input }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
          minCallsForBaseline: 10,
        },
      });

      const customersDelete = defineAction({
        name: "customers.delete",
        description: "Delete a customer",
        permission: "customers.delete",
        inputSchema: z.object({ id: z.string() }),
        handler: async (input) => ({ deleted: true, id: input.id }),
        behavioralDriftConfig: {
          ...DEFAULT_BEHAVIORAL_DRIFT_CONFIG,
          baselineWindowDays: 1,
          recentWindowHours: 6,
          minCallsForBaseline: 10,
        },
      });

      const now = new Date();
      // Establish baseline of only notes.create (older than 6h, within 24h baseline window)
      // Insert 2 events per hour for 13 hours (hours 8-20) = 26 events
      for (let hour = 8; hour <= 20; hour++) {
        for (let i = 0; i < 2; i++) {
          await dbClient.insertActionEvent({
            actionName: "notes.create",
            actorType: "agent",
            actorId: "test-agent",
            input: { title: `Note ${hour}-${i}` },
            output: { id: `note-${hour}-${i}` },
            error: null,
            permissionResult: "allow",
            approvedBy: null,
            parentEventId: null,
            startedAt: new Date(now.getTime() - hour * 3600000),
            durationMs: 10,
            workspaceId: "ws-1",
            blastRadius: null,
          });
        }
      }

      // Trigger containment
      await expect(
        customersDelete.execute(
          { id: "cust-1" },
          makeCtx(),
          dbClient
        )
      ).rejects.toThrow(ActionContainmentError);

      // Subsequent unrelated call should be denied
      await expect(
        notesCreate.execute(
          { title: "Should be denied" },
          makeCtx(),
          dbClient
        )
      ).rejects.toThrow(ActionContainmentError);

      const error = await notesCreate.execute(
        { title: "Should be denied" },
        makeCtx(),
        dbClient
      ).catch((e) => e);
      expect(error.errorCode).toBe("ACTOR_CONTAINED");
      expect(error.message).toContain("behavioral_drift");
    });
  });
});