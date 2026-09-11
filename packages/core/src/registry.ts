import type { DefinedAction } from "./types";

export class ActionRegistry {
  private actions = new Map<string, DefinedAction<any>>();

  register(action: DefinedAction<any>): void {
    if (this.actions.has(action.name)) {
      throw new Error(`Action "${action.name}" is already registered`);
    }
    this.actions.set(action.name, action);
  }

  get(name: string): DefinedAction<any> | undefined {
    return this.actions.get(name);
  }

  list(): DefinedAction<any>[] {
    return Array.from(this.actions.values());
  }
}
