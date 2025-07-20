import readline from "readline";
import { OpenAI } from "openai";

import {
  accessProject,
  drizzleOrmSetup,
  generateDrizzleSchema,
  getDataset,
  seedDatabase,
  generateAPIRoute,
  generateAPIRouteForTables,
  generateSchemaForTables,
  seedSpecificTables,
} from "./actions";
import { validateUserRequest } from "./actions/validation";
import {
  getParsedData,
  getTablesNeedingSchema,
  getTablesNeedingSeeding,
  extractTableNameFromQuery,
} from "./helperFunctions";
import { SYSTEM_PROMPT } from "./prompts";

// const program = new Command();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tools = {
  "check-drizzle": drizzleOrmSetup,
  "extract-data": getDataset,
  "validate-request": validateUserRequest,
  "generate-api": generateAPIRoute,
  "generate-api-for-tables": generateAPIRouteForTables,
  "generate-schema-for-tables": async (
    dir: string,
    tableNames?: string | string[]
  ) => {
    const names = Array.isArray(tableNames)
      ? tableNames
      : tableNames
      ? [tableNames]
      : undefined;
    return generateSchemaForTables(dir, names);
  },
  "seed-specific-tables": async (
    dir: string,
    tableNames?: string | string[]
  ) => {
    const names = Array.isArray(tableNames)
      ? tableNames
      : tableNames
      ? [tableNames]
      : undefined;
    return seedSpecificTables(dir, names);
  },
};

async function agentLoop(projectPath: string, userQuery: string) {
  console.log(`\n🤖 AI Agent starting with query: "${userQuery}"`);
  console.log(`📁 Project path: ${projectPath}\n`);

  const messages: Array<{ role: string; content: string }> = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
  ];

  // Add the user query
  messages.push({ role: "user", content: JSON.stringify(userQuery) });

  while (true) {
    try {
      const chat = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages as any,
        response_format: { type: "json_object" },
      });

      const result = chat.choices[0]?.message.content;
      if (!result) {
        console.log("❌ No response from AI");
        break;
      }

      messages.push({ role: "assistant", content: result });
      const action = JSON.parse(result);

      console.log(`\n🔄 Action: ${action.type}`);

      if (action.type === "plan") {
        console.log(`📋 Plan: ${action.plan}`);
      } else if (action.type === "action") {
        console.log(`⚡ Executing: ${action.function}`);
        console.log(`📂 Input: ${action.input}`);

        const tool = tools[action.function as keyof typeof tools];
        if (!tool) {
          console.log(`❌ Tool ${action.function} not found`);
          break;
        }

        // Use the actual project path instead of action.input
        const actualInput =
          action.input === "project_path" ? projectPath : action.input;

        let observation;
        if (action.function === "validate-request") {
          // For validate-request, pass both project path and original user query
          observation = await (tool as any)(projectPath, userQuery);
        } else if (action.function === "generate-api") {
          // For generate-api, pass both project path and original user query
          observation = await (tool as any)(actualInput, userQuery);
        } else if (action.function === "generate-api-for-tables") {
          // For generate-api-for-tables, extract table names from user query
          const parsedData = await getParsedData(projectPath);
          const availableTables = Object.keys(parsedData).filter(
            (table) => table !== "apiRoutes"
          );

          // Extract table names from user query (looking for "products" and "teams")
          const tableNames: string[] = [];
          if (userQuery.toLowerCase().includes("products")) {
            tableNames.push("products");
          }
          if (userQuery.toLowerCase().includes("teams")) {
            tableNames.push("teams");
          }

          if (tableNames.length === 0) {
            observation =
              "No valid table names found in query. Looking for 'products' or 'teams'.";
          } else {
            observation = await (tool as any)(projectPath, tableNames);
          }
        } else if (
          action.function === "generate-schema-for-tables" ||
          action.function === "seed-specific-tables"
        ) {
          // For granular operations, extract table name from user query if not provided
          let tableNames: string[] | undefined;

          if (action.input && action.input !== "project_path") {
            // Handle comma-separated table names
            if (action.input.includes(",")) {
              tableNames = action.input
                .split(",")
                .map((name: string) => name.trim());
            } else {
              tableNames = [action.input];
            }
          } else {
            // Try to extract table name from user query using GPT
            const parsedData = await getParsedData(projectPath);
            const availableTables = Object.keys(parsedData).filter(
              (table) => table !== "apiRoutes"
            );
            const extractedTableName = await extractTableNameFromQuery(
              userQuery,
              availableTables
            );

            if (extractedTableName) {
              tableNames = [extractedTableName];
              console.log(
                `🎯 Extracted table name from query: ${extractedTableName}`
              );
            }
          }

          observation = await (tool as any)(projectPath, tableNames);
        } else {
          observation = await (tool as any)(actualInput, userQuery);
        }

        console.log(`✅ Observation: ${observation}`);

        const observationMessage = {
          type: "observation",
          observation: observation,
        };
        messages.push({
          role: "developer",
          content: JSON.stringify(observationMessage),
        });
      } else if (action.type === "output") {
        console.log(`\n🎉 AI Agent completed successfully!`);
        console.log(`📤 Output: ${action.output}`);
        break;
      }
    } catch (error) {
      console.error("❌ Error in AI Agent loop:", error);
      break;
    }
  }
}

let projectPath: string | null = null;

function promptForProjectPath() {
  rl.question("Please enter the project path: ", (path) => {
    projectPath = path.trim();
    console.log(`Project path set to: ${projectPath}`);
    showHelp();
    rl.prompt();
  });
}

// Start the CLI by prompting for project path
promptForProjectPath();

function showHelp() {
  console.log("\nSample Commands:");
  console.log("  ai        - AI Agent: Let AI handle the workflow");
  console.log("             Example: ai store recently played music");
  console.log("             Example: ai create API for recently played songs");
  console.log(
    "  validate  - Validate if a request can be fulfilled with available data"
  );
  console.log("             Example: validate store recently played music");
  console.log(
    "             Example: validate create API for ecommerce products"
  );
  console.log("  schema-for - Generate schema for specific tables");
  console.log("             Example: schema-for recentlyPlayed");
  console.log("             Example: schema-for recentlyPlayed popularAlbums");
  console.log("  seed-for   - Seed specific tables");
  console.log("             Example: seed-for recentlyPlayed");
  console.log("             Example: seed-for recentlyPlayed popularAlbums");
  console.log("  api-for    - Generate API routes for specific tables");
  console.log("             Example: api-for products");
  console.log("             Example: api-for products teams");
  console.log("  status     - Show status of all tables (schema/seeded)\n");
  console.log("  exit      - Exit the CLI\n");
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
            // Skip apiRoutes table
            if (tableName === "apiRoutes") {
              continue;
            }
            console.log(`\n${tableName} (${data.data.length} records):`);
            if (data.data.length > 0) {
              console.log(
                "Sample record:",
                JSON.stringify(data.data[0], null, 2)
              );
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
      case "validate":
        if (args.length < 2) {
          console.log("Usage: validate <query>");
          console.log("Example: validate store recently played music");
          console.log("Example: validate create API for ecommerce products");
          rl.prompt();
          return;
        }
        const validateQuery = args.slice(1).join(" ");
        await validateUserRequest(projectPath, validateQuery);
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
      case "api-for":
        if (args.length < 2) {
          console.log("Usage: api-for <table1> [table2] [table3] ...");
          console.log("Example: api-for products");
          console.log("Example: api-for products teams");
          rl.prompt();
          return;
        }
        const apiTables = args.slice(1);
        await generateAPIRouteForTables(projectPath, apiTables);
        break;
      case "ai":
        if (args.length < 2) {
          console.log("Usage: ai <query>");
          console.log("Example: ai store recently played music");
          console.log("Example: ai create API for recently played songs");
          rl.prompt();
          return;
        }
        const aiQuery = args.slice(1).join(" ");
        await agentLoop(projectPath, aiQuery);
        break;
      case "schema-for":
        if (args.length < 2) {
          console.log("Usage: schema-for <table1> [table2] [table3] ...");
          console.log("Example: schema-for recentlyPlayed");
          console.log("Example: schema-for recentlyPlayed popularAlbums");
          rl.prompt();
          return;
        }
        const schemaTables = args.slice(1);
        await generateSchemaForTables(projectPath, schemaTables);
        break;
      case "seed-for":
        if (args.length < 2) {
          console.log("Usage: seed-for <table1> [table2] [table3] ...");
          console.log("Example: seed-for recentlyPlayed");
          console.log("Example: seed-for recentlyPlayed popularAlbums");
          rl.prompt();
          return;
        }
        const seedTables = args.slice(1);
        await seedSpecificTables(projectPath, seedTables);
        break;
      case "status":
        const statusData = await getParsedData(projectPath);
        if (Object.keys(statusData).length > 0) {
          console.log("\nTable Status:");
          for (const [tableName, data] of Object.entries(statusData)) {
            if (tableName === "apiRoutes") continue;
            const status = data.status || {};
            console.log(`\n${tableName}:`);
            console.log(`  Records: ${data.data.length}`);
            console.log(
              `  Schema Generated: ${status.schemaGenerated ? "✅" : "❌"}`
            );
            console.log(`  Seeded: ${status.seeded ? "✅" : "❌"}`);
          }
        } else {
          console.log("No data found. Run 'imports' first to extract data.");
        }
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
