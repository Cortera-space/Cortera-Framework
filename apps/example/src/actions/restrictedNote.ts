import { z } from "zod";
import { defineAction } from "@cortera/core";

export const restrictedNoteAction = defineAction({
  name: "restrictedNote",
  description: "Creates a note with a narrow blast radius",
  permission: "notes.create",
  inputSchema: z.object({
    title: z.string().min(1),
    content: z.string().min(1),
  }),
  blastRadius: ["notes.*"],
  handler: async (input) => {
    return { id: "note-" + Date.now(), ...input };
  },
});
