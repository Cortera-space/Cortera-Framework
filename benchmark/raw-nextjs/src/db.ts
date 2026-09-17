import type { AuditLogEntry } from "./types";

const invoices: Array<{ id: string; customerId: string; amount: number; dueDate: string; notes: string | undefined; createdAt: string }> = [];
const auditLog: AuditLogEntry[] = [];

let invoiceIdCounter = 0;
let auditIdCounter = 0;

export const db = {
  invoices: {
    create: (data: { customerId: string; amount: number; dueDate: string; notes?: string }): { id: string; customerId: string; amount: number; dueDate: string; notes: string | undefined; createdAt: string } => {
      invoiceIdCounter++;
      const createdAt = new Date().toISOString();
      const invoice = {
        id: `inv-${invoiceIdCounter}-${Date.now()}`,
        ...data,
        createdAt,
      };
      invoices.push(invoice);
      return invoice;
    },
    findAll: () => invoices,
    findById: (id: string) => invoices.find((inv) => inv.id === id),
  },
  auditLog: {
    write: (entry: Omit<AuditLogEntry, "id">): AuditLogEntry => {
      auditIdCounter++;
      const auditEntry: AuditLogEntry = {
        id: `audit-${auditIdCounter}-${Date.now()}`,
        ...entry,
      };
      auditLog.push(auditEntry);
      return auditEntry;
    },
    findAll: () => auditLog,
    findById: (id: string) => auditLog.find((entry) => entry.id === id),
  },
};

export function clearDb() {
  invoices.length = 0;
  auditLog.length = 0;
  invoiceIdCounter = 0;
  auditIdCounter = 0;
}