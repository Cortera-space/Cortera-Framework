import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";

const ACTION_TEMPLATE = `import { z } from "zod";
import { defineAction } from "@tera/core";

export const {{name}}Action = defineAction({
  name: "{{name}}",
  description: "TODO: Describe what this action does",
  permission: "TODO:permission.key",
  inputSchema: z.object({
    exampleField: z.string().describe("TODO: Describe this field"),
  }),
  // approvalTtlMs: 24 * 60 * 60 * 1000, // Optional: custom approval TTL (default: 24h)
  // blastRadius: ["permission.pattern*"], // Optional: restrict downstream actions
  handler: async (input) => {
    // TODO: Implement action logic
    return { success: true, ...input };
  },
});
`;

export const generateCommand = new Command("generate")
  .description("Scaffold new Tera project files")
  .addCommand(
    new Command("action")
      .description("Generate a new Action file")
      .argument("<name>", "Action name (e.g., createNote, deleteCustomer)")
      .option("-o, --output <dir>", "Output directory", "src/actions")
      .action(async (name, options) => {
        const outputDir = resolve(process.cwd(), options.output);
        const fileName = `${name}Action.ts`;
        const filePath = resolve(outputDir, fileName);

        const template = ACTION_TEMPLATE.replace(/{{name}}/g, name);

        try {
          await mkdir(outputDir, { recursive: true });
          await writeFile(filePath, template);
          console.log(chalk.green(`✓ Created ${filePath}`));
          console.log(chalk.yellow("\n⚠️  Remember to register this action in your ActionRegistry:"));
          console.log(chalk.gray(`   import { ${name}Action } from "./actions/${fileName}";`));
          console.log(chalk.gray(`   registry.register(${name}Action);`));
        } catch (error) {
          console.error(chalk.red("✗ Failed to create action file:"), error);
          process.exit(1);
        }
      })
  );