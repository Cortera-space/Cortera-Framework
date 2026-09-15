import { z } from "zod";
import { defineAction, type ActionContext } from "@tera/core";

const archivedNotes = new Map<string, { id: string; title: string; content: string }>();

export const archiveNoteAction = defineAction({
  name: "archiveNote",
  description: "Archives a note (reversible with rollback)",
  permission: "notes.archive",
  inputSchema: z.object({
    noteId: z.string(),
  }),
  riskTier: "delayed",
  handler: async (input) => {
    return { archived: true, noteId: input.noteId };
  },
  rollback: async (output, ctx: ActionContext) => {
    const originalInput = ctx.parentEventId 
      ? { noteId: (output as any).noteId }
      : { noteId: (output as any).noteId };
    return { restored: true, noteId: originalInput.noteId };
  },
});