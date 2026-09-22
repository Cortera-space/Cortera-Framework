#!/usr/bin/env node
import { Command } from "commander";
import { PostgresDbClient } from "@tera/db";
import { createApiKey, revokeApiKey, listApiKeys } from "@tera/auth";
import { devCommand } from "./commands/dev.js";
import { generateCommand } from "./commands/generate.js";
import { migrateCommand } from "./commands/migrate.js";
import { checkCommand } from "./commands/check.js";
import { version } from "../package.json";

const program = new Command();

program
  .name("tera")
  .description("Tera CLI - Build, run, and inspect Tera projects")
  .version(version)
  .addCommand(devCommand)
  .addCommand(generateCommand)
  .addCommand(migrateCommand)
  .addCommand(checkCommand);

const keysCommand = program
  .command("keys")
  .description("Manage API keys");

keysCommand
  .command("create <name>")
  .description("Create a new API key")
  .option("-w, --workspace <workspaceId>", "Workspace ID", "default-workspace")
  .option("-c, --connection <connectionString>", "PostgreSQL connection string", process.env.DATABASE_URL)
  .option("--actor-id <actorId>", "Actor ID for the API key")
  .action(async (name: string, options: { workspace: string; connection: string; actorId?: string }) => {
    console.log("API key creation is not yet implemented (planned for Stage 9)");
    process.exit(0);
  });

keysCommand
  .command("list")
  .description("List all API keys in a workspace")
  .option("-w, --workspace <workspaceId>", "Workspace ID", "default-workspace")
  .option("-c, --connection <connectionString>", "PostgreSQL connection string", process.env.DATABASE_URL)
  .action(async (options: { workspace: string; connection: string }) => {
    if (!options.connection) {
      console.error("Error: Database connection string required. Set DATABASE_URL or use --connection");
      process.exit(1);
    }

    const dbClient = new PostgresDbClient({ connectionString: options.connection });
    
    try {
      const keys = await listApiKeys(dbClient, options.workspace);
      
      if (keys.length === 0) {
        console.log("No API keys found.");
        return;
      }

      console.log(`\nAPI Keys in workspace "${options.workspace}":\n`);
      console.log("┌──────────────────────┬──────────────────────┬──────────────────────┬────────────┐");
      console.log("│ Name                 │ Created              │ Last Used            │ Status     │");
      console.log("├──────────────────────┼──────────────────────┼──────────────────────┼────────────┤");
      
      for (const key of keys) {
        const name = key.name.padEnd(20);
        const created = key.createdAt.toISOString().replace("T", " ").substring(0, 19).padEnd(20);
        const lastUsed = key.lastUsedAt 
          ? key.lastUsedAt.toISOString().replace("T", " ").substring(0, 19).padEnd(20)
          : "Never".padEnd(20);
        const status = key.revokedAt ? "Revoked".padEnd(10) : "Active".padEnd(10);
        
        console.log(`│ ${name} │ ${created} │ ${lastUsed} │ ${status} │`);
      }
      
      console.log("└──────────────────────┴──────────────────────┴──────────────────────┴────────────┘\n");
    } catch (error) {
      console.error("Error listing API keys:", error);
      process.exit(1);
    } finally {
      await dbClient.close();
    }
  });

keysCommand
  .command("revoke <keyId>")
  .description("Revoke an API key")
  .option("-c, --connection <connectionString>", "PostgreSQL connection string", process.env.DATABASE_URL)
  .action(async (keyId: string, options: { connection: string }) => {
    if (!options.connection) {
      console.error("Error: Database connection string required. Set DATABASE_URL or use --connection");
      process.exit(1);
    }

    const dbClient = new PostgresDbClient({ connectionString: options.connection });
    
    try {
      await revokeApiKey(dbClient, keyId);
      console.log(`\n✅ API key ${keyId} has been revoked.\n`);
    } catch (error) {
      console.error("Error revoking API key:", error);
      process.exit(1);
    } finally {
      await dbClient.close();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});