import readline from "readline";
import { Command } from "commander";
import {
  accessProject,
  drizzleOrmSetup,
  generateDrizzleSchema,
  getDataset,
  seedDatabase,
  getParsedData,
  generateAPIRoute,
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
  console.log("  data     - View extracted data from data.json");
  console.log("  drizzle  - Check drizzle config");
  console.log("  schema   - Generate drizzle orm schema");
  console.log("  seed     - Seed the database with extracted data");
  console.log("  api      - Generate API route (usage: api <query>)");
  console.log("            Example: api create API for recently played songs");
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
        await getDataset(projectPath);
        break;
      case "data":
        const parsedData = await getParsedData(projectPath);
        if (Object.keys(parsedData).length > 0) {
          console.log("\nExtracted data summary:");
          for (const [tableName, data] of Object.entries(parsedData)) {
            console.log(`\n${tableName} (${data.length} records):`);
            if (data.length > 0) {
              console.log("Sample record:", JSON.stringify(data[0], null, 2));
            }
          }
        }
        break;
      case "drizzle":
        await drizzleOrmSetup(projectPath);
        break;
      case "schema":
        await generateDrizzleSchema(projectPath);
        break;
      case "seed":
        await seedDatabase(projectPath);
        break;
      case "api":
        if (args.length < 2) {
          console.log("Usage: api <query>");
          console.log("Example: api create API for recently played songs");
          rl.prompt();
          return;
        }
        const userQuery = args.slice(1).join(" ");
        await generateAPIRoute(projectPath, userQuery);
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
