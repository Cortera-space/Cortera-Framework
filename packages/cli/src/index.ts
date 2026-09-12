#!/usr/bin/env node
import { Command } from "commander";
import { devCommand } from "./commands/dev.js";
import { generateCommand } from "./commands/generate.js";
import { migrateCommand } from "./commands/migrate.js";
import { keysCommand } from "./commands/keys.js";
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
  .addCommand(keysCommand)
  .addCommand(checkCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});