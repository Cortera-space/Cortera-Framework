import type {
  Actor,
  PermissionEngine,
  PermissionResult,
  PermissionRule,
  DefinedAction,
} from "./types";

export class InMemoryPermissionEngine implements PermissionEngine {
  private rules: PermissionRule[] = [];

  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  async check(
    actor: Actor,
    action: DefinedAction<any>,
    _input: unknown,
    _workspaceId: string
  ): Promise<PermissionResult> {
    for (const rule of this.rules) {
      if (rule.permissionKey !== action.permission) {
        continue;
      }
      if (rule.actorId && rule.actorId !== actor.actorId) {
        continue;
      }
      if (rule.actorType && rule.actorType !== actor.actorType) {
        continue;
      }
      return rule.result;
    }
    return "deny";
  }
}
