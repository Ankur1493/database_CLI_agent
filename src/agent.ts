import {
  drizzleOrmSetup,
  getDataset,
  generateDrizzleSchema,
  seedDatabase,
  generateAPIRoute,
} from "./helperFunctions";
import readlineSync from "readline-sync";
import { OpenAI } from "openai";

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
 
Available actions:
- check-drizzle: Check and install drizzle ORM if missing -- this is always the first action you should take if users says setup database this is what you need to do returns true if drizzle is installed and false if it fails to install
- extract-data: Extract data from components and save to data.json -- this is the step where the function extracts data from user's project - you only need to run this if user asks you to create schema/api or seed database  
- generate-schema: Generate Drizzle ORM schema from extracted data -- This generates the schema based on the data extracted from the user's project - do this only if user asks to either store some data  or create an api route
- seed-database: Seed the database with extracted data -- this is the step which we run when user says store data or create an api route - we never run this step more than once in our whole journey
- generate-api: Generate a Next.js API route using GPT (for specific queries like "create API for recently played songs") -- this is the step where we generate the api route based on the user's query

Example:

START
{"type": "user", "plan": "I need to setup database"}
{type: "plan", "plan": "I need to run check-drizzle to setup drizzle orm if missing"}
{type: "action", "function": "check-drizzle", "input": "directory path"}
{type: "observation", "observation": "true"}
{type: "output", "output": "Drizzle orm is installed successfully"}
END

START
{"type": "user", "plan": "I need to store recently played music"}
{type: "plan", "plan": "I need to run extract-data to extract data from components"}
{type: "action", "function": "extract-data", "input": "directory path"}
{type: "observation", "observation": "data extracted successfully"}
{type: "plan", "plan": "I need to run generate-schema to generate schema from extracted data"}
{type: "action", "function": "generate-schema", "input": "directory path"}
{type: "observation", "observation": "schema generated successfully"}
{type: "plan", "plan": "I need to run seed-database to seed the database with extracted data"}
{type: "action", "function": "seed-database", "input": "directory path"}
{type: "observation", "observation": "database seeded successfully"}
{type: "output", "output": "Database is setup and data is stored successfully"}
END

START
{"type": "user", "plan": "I need to create an api route for recently played songs"}
{type: "plan", "plan": "I need to run check-drizzle to setup drizzle orm if missing"}
{type: "action", "function": "check-drizzle", "input": "directory path"}
{type: "observation", "observation": "true"}
{type: "output", "output": "Drizzle orm is installed successfully"}
{type: "plan", "plan": "I need to run extract-data to extract data from components"}
{type: "action", "function": "extract-data", "input": "directory path"}
{type: "observation", "observation": "data extracted successfully"}
{type: "plan", "plan": "I need to run generate-schema to generate schema from extracted data"}
{type: "action", "function": "generate-schema", "input": "directory path"}
{type: "observation", "observation": "schema generated successfully"}
{type: "plan", "plan": "I need to run seed-database to seed the database with extracted data"}
{type: "action", "function": "seed-database", "input": "directory path"}
{type: "observation", "observation": "database seeded successfully"}
{type: "output", "output": "Database is setup and data is stored successfully"}
{type: "plan", "plan": "I need to run generate-api to generate an api route for recently played songs"}
{type: "action", "function": "generate-api", "input": "directory path"}
{type: "observation", "observation": "api route generated successfully"}
{type: "output", "output": "API route is generated successfully"}
END
`;

const messages: Array<{ role: string; content: string }> = [
  {
    role: "system",
    content: SYSTEM_PROMPT,
  },
];

while (true) {
  const query = readlineSync.question("Enter your query: ");
  const userMessage = {
    role: "user",
    content: query,
  };
  messages.push({ role: "user", content: JSON.stringify(query) });
  while (true) {
    const chat = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages as any,
      response_format: { type: "json_object" },
    });
    const result = chat.choices[0]?.message.content;
    messages.push({ role: "assistant", content: result || "" });

    const action = JSON.parse(result || "{}");

    if (action.type === "output") {
      console.log(`\n BOT: ${action.output}`);
      break;
    } else if (action.type === "action") {
      const tool = tools[action.function as keyof typeof tools];
      if (!tool) {
        console.log(`\n BOT: Tool ${action.function} not found`);
        break;
      }
      const observation = await tool(action.input);
      const observationMessage = {
        type: "observation",
        observation: observation,
      };
      messages.push({
        role: "developer",
        content: JSON.stringify(observationMessage),
      });
    }
  }
}
