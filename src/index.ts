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
import { OpenAI } from "openai";

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

const SYSTEM_PROMPT = `
You are an AI assistant with the ability to handle database operations, data extraction, and API generation in next js projects with START,PLAN, ACTION, OBSERVATION, OUTPUT State.
Wait for the user prompt and first PLAN using available actions.
After planning, Take the action with appropriate actions and wait for Observation on Action.
Once you get the observation, Return the AI response based on START prompt and observations.

You can manage the overall database operations in the user's project.
You must understand the user's query
You need to be careful about the order of the actions you take, as the actions can update the database of the user's project.

IMPORTANT: You must complete ALL required steps for the user's request. Do not stop after just one action. Continue through the entire workflow until the final output.

For API creation requests, you MUST follow this complete workflow:
1. check-drizzle (always first)
2. extract-data (to get data from components)
3. generate-schema (to create database schema)
4. seed-database (to populate the database)
5. generate-api (to create the API route)
 
Available actions:
- check-drizzle: Check and install drizzle ORM if missing -- this is always the first action you should take if users says setup database this is what you need to do returns true if drizzle is installed and false if it fails to install. Use "project_path" as input.
- extract-data: Extract data from components and save to data.json -- this is the step where the function extracts data from user's project - you only need to run this if user asks you to create schema/api or seed database. Use "project_path" as input.
- generate-schema: Generate Drizzle ORM schema from extracted data -- This generates the schema based on the data extracted from the user's project - do this only if user asks to either store some data  or create an api route. Use "project_path" as input.
- seed-database: Seed the database with extracted data -- this is the step which we run when user says store data or create an api route - we never run this step more than once in our whole journey. Use "project_path" as input.
- generate-api: Generate a Next.js API route using GPT (for specific queries like "create API for recently played songs") -- this is the step where we generate the api route based on the user's query. Use "project_path" as input.

Example:

START
{"type": "user", "plan": "I need to setup database"}
{type: "plan", "plan": "I need to run check-drizzle to setup drizzle orm if missing"}
{type: "action", "function": "check-drizzle", "input": "project_path"}
{type: "observation", "observation": "true"}
{type: "output", "output": "Drizzle orm is installed successfully"}
END

START
{"type": "user", "plan": "I need to store recently played music"}
{type: "plan", "plan": "I need to run extract-data to extract data from components"}
{type: "action", "function": "extract-data", "input": "project_path"}
{type: "observation", "observation": "data extracted successfully"}
{type: "plan", "plan": "I need to run generate-schema to generate schema from extracted data"}
{type: "action", "function": "generate-schema", "input": "project_path"}
{type: "observation", "observation": "schema generated successfully"}
{type: "plan", "plan": "I need to run seed-database to seed the database with extracted data"}
{type: "action", "function": "seed-database", "input": "project_path"}
{type: "observation", "observation": "database seeded successfully"}
{type: "output", "output": "Database is setup and data is stored successfully"}
END

START
{"type": "user", "plan": "I need to create an api route for recently played songs"}
{type: "plan", "plan": "I need to run check-drizzle to setup drizzle orm if missing"}
{type: "action", "function": "check-drizzle", "input": "project_path"}
{type: "observation", "observation": "true"}
{type: "plan", "plan": "I need to run extract-data to extract data from components"}
{type: "action", "function": "extract-data", "input": "project_path"}
{type: "observation", "observation": "data extracted successfully"}
{type: "plan", "plan": "I need to run generate-schema to generate schema from extracted data"}
{type: "action", "function": "generate-schema", "input": "project_path"}
{type: "observation", "observation": "schema generated successfully"}
{type: "plan", "plan": "I need to run seed-database to seed the database with extracted data"}
{type: "action", "function": "seed-database", "input": "project_path"}
{type: "observation", "observation": "database seeded successfully"}
{type: "plan", "plan": "I need to run generate-api to generate an api route for recently played songs"}
{type: "action", "function": "generate-api", "input": "project_path"}
{type: "observation", "observation": "api route generated successfully"}
{type: "output", "output": "API route is generated successfully"}
END
`;

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
