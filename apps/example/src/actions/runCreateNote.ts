import { createNoteAction } from "./createNote";

const ctx = {
  actor: { actorType: "human" as const, actorId: "demo-user" },
  workspaceId: "demo-workspace",
};

async function main() {
  try {
    const result = await createNoteAction.execute(
      { title: "Hello Tera", content: "First note" },
      ctx
    );
    console.log("Action executed successfully:", result);
  } catch (error) {
    console.error("Action failed:", error);
    process.exit(1);
  }
}

main();
