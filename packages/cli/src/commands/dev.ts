import { Command } from "commander";
import { execa } from "execa";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const devCommand = new Command("dev")
  .description("Start the development server with realtime dependencies")
  .option("-p, --port <port>", "Port for the dev server", "3000")
  .option("--example-app", "Run the example app instead of current project", false)
  .action(async (options) => {
    const isExampleApp = options.exampleApp;
    const projectRoot = isExampleApp
      ? resolve(__dirname, "../../../apps/example")
      : process.cwd();

    console.log(chalk.cyan("\n🚀 Starting Cortera Framework development environment...\n"));

    if (!existsSync(resolve(projectRoot, "package.json"))) {
      console.error(chalk.red("Error: No package.json found. Are you in a Cortera Framework project?"));
      process.exit(1);
    }

    const hasSupabase = await checkSupabaseRunning();
    if (!hasSupabase) {
      console.log(chalk.yellow("⚠️  Local Supabase not detected. Some realtime features may not work."));
      console.log(chalk.gray("   Run 'supabase start' to enable SSE/Realtime functionality.\n"));
    }

    const devServerUrl = `http://localhost:${options.port}`;
    const restBasePath = "/actions";
    const mcpEndpoint = "/mcp";
    const dataApiBasePath = "/api/cortera";

    console.log(chalk.green("✓ Development server starting..."));
    console.log(chalk.bold("\n📋 Startup Summary:"));
    console.log(chalk.gray("─".repeat(50)));
    console.log(`${chalk.bold("Dev Server:")}      ${chalk.cyan(devServerUrl)}`);
    console.log(`${chalk.bold("REST Base Path:")}  ${chalk.cyan(restBasePath)}`);
    console.log(`${chalk.bold("MCP Endpoint:")}    ${chalk.cyan(mcpEndpoint)}`);
    console.log(`${chalk.bold("Data API Base:")}   ${chalk.cyan(dataApiBasePath)}`);
    console.log(`${chalk.bold("Supabase Realtime:")} ${hasSupabase ? chalk.green("Connected") : chalk.red("Not running (run 'supabase start')")}`);
    console.log(chalk.gray("─".repeat(50)));
    console.log(chalk.gray("\nPress Ctrl+C to stop\n"));

    try {
      await execa("pnpm", ["dev"], {
        cwd: projectRoot,
        stdio: "inherit",
        env: { ...process.env, PORT: options.port },
      });
    } catch (error) {
      if ((error as Error).message.includes("SIGINT") || (error as Error).message.includes("SIGTERM")) {
        console.log(chalk.yellow("\n👋 Development server stopped"));
      } else {
        console.error(chalk.red("\n✗ Failed to start development server:"), error);
        process.exit(1);
      }
    }
  });

async function checkSupabaseRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa("supabase", ["status"], { timeout: 5000 });
    return stdout.includes("Running") || stdout.includes("started");
  } catch {
    return false;
  }
}