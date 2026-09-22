import { Command } from "commander";
import { execa } from "execa";
import chalk from "chalk";
import { existsSync } from "fs";
import { resolve } from "path";

export const migrateCommand = new Command("migrate")
  .description("Apply pending database migrations")
  .option("--down", "Rollback last migration", false)
  .option("--db-url <url>", "Database connection string (defaults to DATABASE_URL env)")
  .action(async (options) => {
    console.log(chalk.cyan("\n🔄 Running database migrations...\n"));

    const dbUrl = options.dbUrl || process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error(chalk.red("Error: DATABASE_URL not set. Provide --db-url or set DATABASE_URL environment variable."));
      process.exit(1);
    }

    const dbPackagePath = resolve(process.cwd(), "packages/db");
    if (!existsSync(dbPackagePath)) {
      console.error(chalk.red("Error: @cortera/db package not found. Run from monorepo root."));
      process.exit(1);
    }

    try {
      if (options.down) {
        console.log(chalk.yellow("Rolling back last migration..."));
        await execa("pnpm", ["migrate:down"], {
          cwd: dbPackagePath,
          stdio: "inherit",
          env: { ...process.env, DATABASE_URL: dbUrl },
        });
        console.log(chalk.green("\n✓ Migration rolled back"));
      } else {
        console.log(chalk.yellow("Applying pending migrations..."));
        await execa("pnpm", ["migrate"], {
          cwd: dbPackagePath,
          stdio: "inherit",
          env: { ...process.env, DATABASE_URL: dbUrl },
        });
        console.log(chalk.green("\n✓ Migrations applied successfully"));
      }
    } catch (error) {
      console.error(chalk.red("\n✗ Migration failed:"), error);
      process.exit(1);
    }
  });