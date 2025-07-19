import readline from "readline";
import { Command } from "commander";
import {
  accessProject,
  drizzleOrmSetup,
  generateDrizzleSchema,
  getDataset,
  seedDatabase,
} from "./helperFunctions";

// const program = new Command();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

let projectPath: string | null = null;

function promptForProjectPath() {
  rl.question("Please enter the project path: ", (path) => {
    projectPath = path.trim();
    console.log(`Project path set to: ${projectPath}`);
    showHelp();
    rl.prompt();
  });
}

function showHelp() {
  console.log("\nAvailable commands:");
  console.log("  ls       - List directory contents");
  console.log("  imports  - Get imports (extract data from components)");
  console.log("  drizzle  - Check drizzle config");
  console.log("  schema   - Generate drizzle orm schema");
  console.log("  seed     - Seed the database with extracted data");
  console.log("  exit     - Exit the CLI\n");
  console.log("Workflow: imports → drizzle → schema → seed");
}

// program
//   .version("1.0.0")
//   .description("A CLI for the Spotify Clone")
//   .option("-n, --name <name>", "Name of the database", "db cragen")
//   .option("-l, --ls <path>", "List directory contents")
//   .option("-i, --imports <path>", "Get imports")
//   .option("-d, --drizzle <path>", "Check drizzle config")
//   .option("-s, --schema <path>", "Generate drizzle orm schema")
//   .option("-q, --query <query>", "Query the database");

// promptForProjectPath();

const dataset: string[] = [];

rl.on("line", async (line) => {
  const input = line.trim();
  if (input === "exit" || input === "quit") {
    rl.close();
    return;
  }

  if (!projectPath) {
    console.log("Project path is not set. Please enter the project path.");
    promptForProjectPath();
    return;
  }

  const args = input.split(" ");
  const command = args[0];

  try {
    switch (command) {
      case "ls":
        await accessProject(projectPath);
        break;
      case "imports":
        //we can later store the data in a json file
        const data = await getDataset(projectPath);
        dataset.push(...data);
        break;
      case "drizzle":
        await drizzleOrmSetup(projectPath);
        break;
      case "schema":
        await generateDrizzleSchema(projectPath, dataset);
        break;
      case "seed":
        await seedDatabase(projectPath, dataset);
        break;
      default:
        console.log("Unknown command");
        showHelp();
    }
  } catch (error) {
    console.error("Error executing command:", error);
  }

  rl.prompt();
}).on("close", () => {
  console.log("Exiting CLI...");
  process.exit(0);
});
