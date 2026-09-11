import { z } from "zod";
import { defineAction } from "@tera/core";

export const createNoteAction = defineAction({
  name: "createNote",
  description: "Creates a new note with a title and content",
  permission: "notes.create",
  inputSchema: z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  }),
  handler: async (input) => {
    return { id: "note-" + Date.now(), ...input };
  },
});
