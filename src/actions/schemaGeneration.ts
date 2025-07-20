import fs from "fs/promises";
import { execSync } from "child_process";
import { OpenAI } from "openai";
import { getParsedData } from "../helperFunctions";
import { SCHEMA_PROMPT } from "../prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Action: Generate the drizzle orm schema
export async function generateDrizzleSchema(dir: string) {
  console.log("generating the drizzle orm schema...");

  // Check if schema already exists and remove it to regenerate
  try {
    const schemaPath = `${dir}/src/drizzle/schema.ts`;
    await fs.access(schemaPath);
    console.log("Existing schema found, removing to regenerate...");
    await fs.unlink(schemaPath);
    return "Schema already exists - regenerating";
  } catch (error) {
    // Schema doesn't exist, continue with generation
    console.log("No existing schema found, generating new schema...");
  }

  // Get parsed data from data.json
  const parsedData = await getParsedData(dir);

  if (Object.keys(parsedData).length === 0) {
    console.log(
      "No data found. Please run 'imports' command first to extract data."
    );
    return "No data found - please run extract-data first";
  }

  // Convert parsed data back to array constants format for the AI prompt
  const arrayConstants: string[] = [];
  for (const [tableName, dataInfo] of Object.entries(parsedData)) {
    const arrayContent = JSON.stringify(dataInfo.data, null, 2);
    const fullConstant = `const ${tableName} = ${arrayContent};`;
    arrayConstants.push(fullConstant);
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a Drizzle ORM + TypeScript expert",
      },
      {
        role: "user",
        content: SCHEMA_PROMPT(arrayConstants),
      },
    ],
  });

  const responseContent = response.choices[0]?.message?.content ?? "";
  // Remove markdown code block markers only
  const importLineMatch = responseContent.match(
    /^(?:\s*\/\/\s*)?\s*import\s+\{[^}]+\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/m
  );
  const importLine =
    importLineMatch?.[0]
      ?.replace(/^\s*\/\/\s*/, "") // Remove leading comment
      .trim() ?? "";
  const schemaBlocks = [
    ...responseContent.matchAll(/export const .*?pgTable\([\s\S]+?\}\);/g),
  ];

  const schemaContent = schemaBlocks.map((match) => match[0]).join("\n\n");

  const processedContent = `${importLine}\n\n${schemaContent}`;

  // Clean up any potential import issues
  const cleanedContent = processedContent
    .replace(
      /import\s+\{[^}]*float[^}]*\}\s+from\s+['"]drizzle-orm\/pg-core['"];?/g,
      "import { pgTable, uuid, varchar, integer, boolean, text, real } from 'drizzle-orm/pg-core';"
    )
    .replace(/float\(/g, "real(");

  // Ensure the drizzle directory exists before writing files
  const drizzleDir = `${dir}/src/drizzle`;
  await fs.mkdir(drizzleDir, { recursive: true });

  await Promise.all([
    fs.writeFile(drizzleDir + "/schema.ts", cleanedContent),
    fs.writeFile(
      drizzleDir + "/db.ts",
      `import { drizzle } from "drizzle-orm/postgres-js";
    import * as schema from "./schema";
    import postgres from "postgres";

    const client = postgres(process.env.DATABASE_URL as string);

    export const db = drizzle(client, { schema, logger: true });
  `
    ),

    fs.writeFile(
      drizzleDir + "/migrate.ts",
      `import dotenv from "dotenv";
dotenv.config({path: ".env"});
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function runMigrations() {
  const migrationClient = postgres(process.env.DATABASE_URL as string, {
    max: 1,
  });

  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder: "./src/drizzle/migrations",
    });
    console.log("Migrations completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await migrationClient.end();
  }
}

runMigrations().catch(console.error);
`
    ),
  ]);

  console.log("Drizzle orm schema generated successfully", cleanedContent);

  // Generate migrations using drizzle-kit
  try {
    console.log("Generating database migrations...");
    execSync("npx drizzle-kit generate", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database migrations generated successfully");

    // Install tsx if not available
    console.log("Installing tsx for TypeScript execution...");
    execSync("npm install --save-dev dotenv tsx --legacy-peer-deps", {
      cwd: dir,
      stdio: "inherit",
    });

    // Run migrations to update the database
    console.log("Running database migrations...");
    execSync("npx tsx src/drizzle/migrate.ts", {
      cwd: dir,
      stdio: "inherit",
    });
    console.log("Database migrations applied successfully");
    return "Drizzle schema generated and database migrations applied successfully";
  } catch (error) {
    console.log("Error during database operations:", error);
    console.log("You can manually run the following commands:");
    console.log("1. npx drizzle-kit generate");
    console.log("2. npm install --save-dev tsx --legacy-peer-deps");
    console.log("3. npx tsx src/drizzle/migrate.ts");
    return "Drizzle schema generated but database migrations failed - check console for manual commands";
  }
}
