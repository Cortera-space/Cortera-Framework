import type {
  DriftDetectorName,
  DriftDetectorFn,
  DriftDetectorMatch,
  ActorCallHistoryEntry,
  ActorBehaviorBaseline,
  BehavioralDriftConfig,
} from "./types";

export class DriftDetectorRegistry {
  private detectors = new Map<DriftDetectorName, DriftDetectorFn>();

  register(name: DriftDetectorName, fn: DriftDetectorFn): void {
    if (this.detectors.has(name)) {
      throw new Error(`Drift detector "${name}" is already registered`);
    }
    this.detectors.set(name, fn);
  }

  get(name: DriftDetectorName): DriftDetectorFn | undefined {
    return this.detectors.get(name);
  }

  list(): Array<{ name: DriftDetectorName; fn: DriftDetectorFn }> {
    return Array.from(this.detectors.entries()).map(([name, fn]) => ({ name, fn }));
  }

  async runAll(
    actorId: string,
    workspaceId: string,
    history: ActorCallHistoryEntry[],
    baseline: ActorBehaviorBaseline | null,
    config: BehavioralDriftConfig
  ): Promise<DriftDetectorMatch[]> {
    const matches: DriftDetectorMatch[] = [];

    for (const [name, fn] of this.detectors.entries()) {
      const match = await fn(actorId, workspaceId, history, baseline, config);
      if (match) {
        matches.push(match);
      }
    }

    return matches;
  }
}

export const defaultDriftDetectorRegistry = new DriftDetectorRegistry();