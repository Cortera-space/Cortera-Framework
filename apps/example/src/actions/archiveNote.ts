import { z } from "zod";
import { defineAction, type ActionContext } from "@cortera/core";

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
  rollback: async (output, _ctx: ActionContext) => {
    const noteId = (output as any).noteId;
    // In a real app, you would restore the note here
    console.log(`Rolling back archive for note ${noteId}`);
  },
});