import { z } from "zod";
import { defineAction } from "@cortera/core";

export const notifyWatchersAction = defineAction({
  name: "notifyWatchers",
  description: "Notifies watchers about a new note",
  permission: "notifications.send",
  inputSchema: z.object({
    noteId: z.string(),
    title: z.string(),
  }),
  handler: async (input) => {
    return { notified: true, noteId: input.noteId };
  },
});
