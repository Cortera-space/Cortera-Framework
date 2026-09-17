import { Command } from "commander";
import chalk from "chalk";
import { glob } from "glob";
import { readFileSync } from "fs";
import { resolve } from "path";

interface ActionInfo {
  name: string;
  filePath: string;
  description: string;
  permission: string;
  approvalTtlMs?: number;
  blastRadius?: string[];
  hasExplicitApprovalTtl: boolean;
  hasBlastRadius: boolean;
}

export const checkCommand = new Command("check")
  .description("Run pre-deploy safety checks on all registered actions")
  .option("--actions-dir <dir>", "Directory containing action files", "src/actions")
  .action(async (options) => {
    console.log(chalk.cyan("\n🔍 Running Tera pre-deploy safety checks...\n"));

    const actionsDir = resolve(process.cwd(), options.actionsDir);
    // Match both *Action.ts (generated) and *.ts (existing) files in actions directory
    const actionFiles = await glob(`${actionsDir}/**/*.ts`);

    if (actionFiles.length === 0) {
      console.log(chalk.yellow("No action files found. Skipping checks."));
      return;
    }

    const actions: ActionInfo[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const filePath of actionFiles) {
      const action = parseActionFile(filePath);
      if (action) {
        actions.push(action);

        if (!action.description || action.description.trim() === "" || action.description.includes("TODO:")) {
          errors.push(`${action.name} (${filePath}): Missing or placeholder description`);
        }

        if (action.hasExplicitApprovalTtl === false) {
          warnings.push(`${action.name} (${filePath}): Using default approvalTtlMs (24h) — consider setting explicitly`);
        }

        if (!action.hasBlastRadius) {
          warnings.push(`${action.name} (${filePath}): No blastRadius set — action has unrestricted downstream scope`);
        }
      }
    }

    console.log(chalk.bold("Results:"));
    console.log(chalk.gray("─".repeat(60)));

    if (errors.length === 0 && warnings.length === 0) {
      console.log(chalk.green("✓ All checks passed"));
      console.log(chalk.gray(`  Checked ${actions.length} action(s)`));
    } else {
      if (errors.length > 0) {
        console.log(chalk.red(`\n✗ Errors (${errors.length}):`));
        for (const err of errors) {
          console.log(chalk.red(`  • ${err}`));
        }
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow(`\n⚠ Warnings (${warnings.length}):`));
        for (const warn of warnings) {
          console.log(chalk.yellow(`  • ${warn}`));
        }
      }

      console.log(chalk.gray(`\n  Checked ${actions.length} action(s)`));
    }

    console.log(chalk.gray("─".repeat(60)));

    if (errors.length > 0) {
      console.log(chalk.red("\n❌ Check failed — fix errors before deploying"));
      process.exit(1);
    } else if (warnings.length > 0) {
      console.log(chalk.yellow("\n⚠ Check passed with warnings"));
      process.exit(0);
    } else {
      console.log(chalk.green("\n✅ Check passed"));
      process.exit(0);
    }
  });

function parseActionFile(filePath: string): ActionInfo | null {
  try {
    const content = readFileSync(filePath, "utf-8");

    const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
    const descriptionMatch = content.match(/description:\s*["']([^"']+)["']/);
    const permissionMatch = content.match(/permission:\s*["']([^"']+)["']/);
    const approvalTtlMatch = content.match(/approvalTtlMs:\s*(\d+)/);
    const blastRadiusMatch = content.match(/blastRadius:\s*(\[.*?\])/s);

    if (!nameMatch) return null;

    return {
      name: nameMatch[1],
      filePath,
      description: descriptionMatch ? descriptionMatch[1] : "",
      permission: permissionMatch ? permissionMatch[1] : "",
      approvalTtlMs: approvalTtlMatch ? parseInt(approvalTtlMatch[1], 10) : undefined,
      blastRadius: blastRadiusMatch ? eval(blastRadiusMatch[1]) : undefined,
      hasExplicitApprovalTtl: !!approvalTtlMatch,
      hasBlastRadius: !!blastRadiusMatch,
    };
  } catch {
    return null;
  }
}