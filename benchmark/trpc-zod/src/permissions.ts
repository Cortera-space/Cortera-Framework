export type Actor = {
  actorType: "human" | "agent" | "system";
  actorId: string;
};

export type PermissionRule = {
  actorType?: Actor["actorType"];
  actorId?: string;
  permissionKey: string;
  result: "allow" | "deny";
};

const permissionRules: PermissionRule[] = [
  { actorType: "human", permissionKey: "invoices.create", result: "allow" },
  { actorType: "agent", permissionKey: "invoices.create", result: "allow" },
  { actorType: "human", permissionKey: "invoices.read", result: "allow" },
  { actorType: "agent", permissionKey: "invoices.read", result: "allow" },
];

export function checkPermission(actor: Actor, permissionKey: string): "allow" | "deny" {
  const rule = permissionRules.find(
    (r) =>
      r.permissionKey === permissionKey &&
      (r.actorType === undefined || r.actorType === actor.actorType) &&
      (r.actorId === undefined || r.actorId === actor.actorId)
  );
  return rule?.result ?? "deny";
}