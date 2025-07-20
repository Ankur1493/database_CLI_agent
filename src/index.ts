import readline from "readline";
import { OpenAI } from "openai";

import {
  accessProject,
  drizzleOrmSetup,
  generateDrizzleSchema,
  getDataset,
  seedDatabase,
  generateAPIRoute,
} from "./actions";
import { getParsedData } from "./helperFunctions";
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
  "generate-schema": generateDrizzleSchema,
  "seed-database": seedDatabase,
  "generate-api": generateAPIRoute,
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
        if (action.function === "generate-api") {
          // For generate-api, pass both project path and original user query
          observation = await tool(actualInput, userQuery);
        } else {
          observation = await tool(actualInput);
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
  console.log("\nAvailable commands:");
  console.log("  ls       - List directory contents");
  console.log("  imports  - Get imports (extract data from components)");
  console.log("  data     - View extracted data from data.json");
  console.log("  drizzle  - Check drizzle config");
  console.log("  schema   - Generate drizzle orm schema");
  console.log("  seed     - Seed the database with extracted data");
  console.log("  api      - Generate API route (usage: api <query>)");
  console.log("            Example: api create API for recently played songs");
  console.log("  ai       - AI Agent: Let AI handle the workflow");
  console.log("            Example: ai store recently played music");
  console.log("            Example: ai create API for recently played songs");
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
